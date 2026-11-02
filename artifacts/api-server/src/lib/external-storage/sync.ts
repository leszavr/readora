import crypto from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  booksTable,
  bookGenresTable,
  chaptersTable,
  cyclesTable,
  db,
  externalBookRelocationsTable,
  externalStorageConnectionsTable,
  externalSyncJobFailuresTable,
  externalSyncJobsTable,
  genresTable,
  usersTable,
  type ExternalStorageConnection,
  type ExternalStorageProvider,
} from "@workspace/db";
import {
  bookFormatFromFilename,
  extractFb2FromZip,
  isExplicitFb2ZipFilename,
  isZipBuffer,
  parseBook,
  type BookFormat,
} from "../parser";
import { resolveGenreIds } from "../genre-resolver";
import { recordServerAnalyticsEvent } from "../analytics-service";
import { storeOptimizedCover, deleteCoverIfUnreferenced } from "../cover-storage";
import {
  downloadExternalFile,
  ExternalStorageError,
  listExternalFolder,
  type ExternalCredentials,
  type ExternalFileEntry,
} from "./drivers";
import { loadConnectionCredentials, markConnectionStatus } from "./connections";
import { chaptersContentBytes, evictExternalContentCacheIfNeeded, upsertBookChapters } from "./content-cache";

// Синхронизация внешнего хранилища: обход rootFolder, импорт новых книг,
// обновление изменённых (по etag/размеру), отметка исчезнувших. Оригиналы
// файлов на сервере не сохраняются — только метаданные, обложки и контент глав
// в оперативном кэше.

const MAX_WALK_DEPTH = 6;
const MAX_FILES_PER_SYNC = 2000;
const DOWNLOAD_DELAY_MS = 200;
// Детализация ошибок пишется не более чем для этого числа файлов;
// счётчик filesFailed в джобе всегда полный.
const MAX_FAILURES_PER_SYNC = 500;
const FAILURE_PATH_MAX = 2000;
const FAILURE_NAME_MAX = 500;
const FAILURE_MESSAGE_MAX = 500;
// Джоба без обновлений дольше этого интервала считается зависшей (например,
// после перезапуска сервера) и помечается failed.
const STALE_ACTIVE_MS = 10 * 60 * 1000;

// Синхронизация скачивает файлы из доверенного облака пользователя, файловые
// лимиты квоты к ней не применяются (размер контролирует драйвер).
const SYNC_PARSE_OPTIONS = { sizeLimits: { maxFileBytes: null } };

type BookFile = { entry: ExternalFileEntry; format: BookFormat; explicitZip: boolean };

// Управляемая остановка воркера (пауза/отмена): статус джобы уже выставлен
// endpoint'ом управления, воркер лишь прекращает работу.
export class SyncControlledStop extends Error {
  constructor(readonly jobStatus: "paused" | "cancelled") {
    super(`Sync job controlled stop: ${jobStatus}`);
  }
}

type SyncJobAction = "pause" | "resume" | "cancel";

export function isValidSyncJobAction(value: unknown): value is SyncJobAction {
  return value === "pause" || value === "resume" || value === "cancel";
}

// Допустимые переходы статусов для действий управления.
export function syncJobStatusAfterAction(
  status: "queued" | "processing" | "paused" | "cancelled" | "completed" | "failed",
  action: SyncJobAction,
): "queued" | "paused" | "cancelled" | null {
  if (action === "pause") {
    return status === "queued" || status === "processing" ? "paused" : null;
  }
  if (action === "cancel") {
    return status === "queued" || status === "processing" || status === "paused" ? "cancelled" : null;
  }
  return status === "paused" ? "queued" : null;
}

// Помечает зависшие активные джобы (перезапуск сервера посреди синхронизации)
// как failed, чтобы UI и блокировка «уже выполняется» не зависали навсегда.
export async function failStaleActiveSyncJobs(): Promise<void> {
  await db
    .update(externalSyncJobsTable)
    .set({
      status: "failed",
      errorMessage: "Синхронизация прервана (перезапуск сервера)",
      completedAt: new Date(),
    })
    .where(
      and(
        inArray(externalSyncJobsTable.status, ["queued", "processing"]),
        sql`${externalSyncJobsTable.updatedAt} < now() - interval '10 minutes'`,
      ),
    );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

export async function collectExternalBookFiles(
  credentials: ExternalCredentials,
  rootFolder: string,
  shouldContinue?: () => Promise<void>,
): Promise<BookFile[]> {
  const files: BookFile[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: rootFolder || "/", depth: 0 }];
  const visited = new Set<string>([rootFolder || "/"]);

  while (queue.length > 0 && files.length < MAX_FILES_PER_SYNC) {
    await shouldContinue?.();
    const { path: folderPath, depth } = queue.shift()!;
    const entries = await listExternalFolder(credentials, folderPath);
    for (const entry of entries) {
      if (entry.isDir) {
        if (depth >= MAX_WALK_DEPTH || visited.has(entry.path)) continue;
        visited.add(entry.path);
        queue.push({ path: entry.path, depth: depth + 1 });
        continue;
      }
      const format = bookFormatFromFilename(entry.name);
      if (!format) continue;
      if (files.length >= MAX_FILES_PER_SYNC) break;
      files.push({ entry, format, explicitZip: isExplicitFb2ZipFilename(entry.name) });
    }
  }
  return files;
}

export function isEntryUnchanged(book: { externalEtag: string | null; fileSize: number; externalModifiedAt: Date | null }, entry: ExternalFileEntry): boolean {
  if (book.externalEtag && entry.etag) return book.externalEtag === entry.etag;
  if (book.fileSize !== entry.size) return false;
  if (book.externalModifiedAt && entry.modifiedAt) {
    return book.externalModifiedAt.getTime() === entry.modifiedAt.getTime();
  }
  return entry.size > 0;
}

export function externalStorageKey(connectionId: number, externalPath: string): string {
  const pathHash = crypto.createHash("sha256").update(externalPath).digest("hex").slice(0, 32);
  return `external/${connectionId}/${pathHash}`;
}

async function applyGenres(bookId: number, genreTokens: string[]): Promise<void> {
  if (genreTokens.length === 0) return;
  const allGenres = await db.select().from(genresTable);
  const matchedIds = resolveGenreIds(genreTokens, allGenres);
  if (matchedIds.length === 0) return;
  await db.insert(bookGenresTable).values(matchedIds.map((gId) => ({ bookId, genreId: gId }))).onConflictDoNothing();
}

// Цикл из метаданных файла (FB2 sequence / EPUB calibre:series): существующий
// цикл владельца по имени либо новый.
async function resolveCycleFromSeries(
  ownerUserId: number,
  seriesName: string | null,
): Promise<{ cycleId: number | null; cycleName: string | null }> {
  if (!seriesName) return { cycleId: null, cycleName: null };
  const [existing] = await db
    .select({ id: cyclesTable.id })
    .from(cyclesTable)
    .where(and(eq(cyclesTable.ownerUserId, ownerUserId), eq(cyclesTable.name, seriesName)));
  if (existing) return { cycleId: existing.id, cycleName: seriesName };
  const [created] = await db
    .insert(cyclesTable)
    .values({ ownerUserId, name: seriesName })
    .returning({ id: cyclesTable.id });
  return { cycleId: created.id, cycleName: seriesName };
}

async function updateSyncJob(jobId: number, values: Partial<typeof externalSyncJobsTable.$inferInsert>): Promise<void> {
  await db.update(externalSyncJobsTable).set(values).where(eq(externalSyncJobsTable.id, jobId));
}

// Книга с совпавшим fileHash уже есть у владельца. Для явного дубликата
// из другого источника — ошибка; для непривязанной локальной — кандидат на
// переезд; для книг этого провайдера — тихая (пере)привязка по пути.
export function classifyHashDuplicate(
  book: { externalConnectionId: number | null; externalProvider: ExternalStorageProvider | null; storageKey: string },
  connection: { id: number; provider: ExternalStorageProvider },
): "candidate" | "attach" | "duplicate" {
  if (book.externalConnectionId === connection.id) return "attach";
  if (book.externalConnectionId !== null) return "duplicate";
  if (book.externalProvider === connection.provider) return "attach";
  if (book.externalProvider === null && !book.storageKey.startsWith("external/")) return "candidate";
  return "duplicate";
}

export class SyncDuplicateError extends Error {
  constructor() {
    super("Книга уже в библиотеке (привязана к другому источнику)");
  }
}

function isExternalStorageKey(storageKey: string): boolean {
  return storageKey.startsWith("external/");
}

async function findBookByFileHash(
  ownerUserId: number,
  fileHash: string,
): Promise<{ id: number; externalConnectionId: number | null; externalProvider: ExternalStorageProvider | null; storageKey: string } | null> {
  const [book] = await db
    .select({
      id: booksTable.id,
      externalConnectionId: booksTable.externalConnectionId,
      externalProvider: booksTable.externalProvider,
      storageKey: booksTable.storageKey,
    })
    .from(booksTable)
    .where(and(eq(booksTable.ownerUserId, ownerUserId), eq(booksTable.fileHash, fileHash)))
    .limit(1);
  return book ?? null;
}

async function recordSyncFailure(
  jobId: number,
  entry: ExternalFileEntry,
  error: unknown,
  reason: "download" | "parse" | "duplicate",
): Promise<void> {
  const message = error instanceof Error && error.message ? error.message : "Не удалось обработать файл";
  await db.insert(externalSyncJobFailuresTable).values({
    jobId,
    externalPath: entry.path.slice(0, FAILURE_PATH_MAX),
    fileName: entry.name.slice(0, FAILURE_NAME_MAX),
    reason,
    errorMessage: message.slice(0, FAILURE_MESSAGE_MAX),
  });
}

// Применяет действие управления (пауза/возобновление/отмена) к джобе
// с проверкой владельца. Возобновление перезапускает воркер.
export async function applySyncJobControl(
  jobId: number,
  ownerUserId: number,
  action: unknown,
): Promise<{ ok: true; job: typeof externalSyncJobsTable.$inferSelect } | { ok: false; status: number; error: string }> {
  if (!isValidSyncJobAction(action)) {
    return { ok: false, status: 400, error: "Недействительное действие (pause, resume или cancel)" };
  }
  const [job] = await db
    .select()
    .from(externalSyncJobsTable)
    .where(and(eq(externalSyncJobsTable.id, jobId), eq(externalSyncJobsTable.ownerUserId, ownerUserId)));
  if (!job) {
    return { ok: false, status: 404, error: "Задача синхронизации не найдена" };
  }
  const nextStatus = syncJobStatusAfterAction(job.status, action);
  if (!nextStatus) {
    return { ok: false, status: 409, error: "Действие неприменимо к текущему статусу задачи" };
  }

  await failStaleActiveSyncJobs();
  const [updated] = await db
    .update(externalSyncJobsTable)
    .set({
      status: nextStatus,
      ...(nextStatus === "queued" ? { errorMessage: null } : {}),
      ...(nextStatus === "cancelled" ? { completedAt: new Date() } : {}),
    })
    .where(eq(externalSyncJobsTable.id, job.id))
    .returning();

  if (nextStatus === "queued") {
    setImmediate(() => {
      runExternalSyncJob(job.id).catch((error) => {
        console.error("External sync job resume failed:", error instanceof Error ? error.message : error);
      });
    });
  }
  return { ok: true, job: updated };
}

export async function runExternalSyncJob(jobId: number): Promise<void> {
  const [job] = await db.select().from(externalSyncJobsTable).where(eq(externalSyncJobsTable.id, jobId));
  if (!job || job.status !== "queued") return;

  const [connection] = await db
    .select()
    .from(externalStorageConnectionsTable)
    .where(eq(externalStorageConnectionsTable.id, job.connectionId));
  if (!connection) {
    await updateSyncJob(jobId, { status: "failed", errorMessage: "Подключение не найдено", completedAt: new Date() });
    return;
  }

  const [owner] = await db
    .select({ id: usersTable.id, analyticsOptIn: usersTable.analyticsOptIn })
    .from(usersTable)
    .where(eq(usersTable.id, job.ownerUserId));

  await updateSyncJob(jobId, { status: "processing", progress: 5, errorMessage: null });

  try {
    await syncConnection(connection, jobId, owner);
    await markConnectionStatus(connection.id, "active", null);
    await db
      .update(externalStorageConnectionsTable)
      .set({ lastSyncedAt: new Date() })
      .where(eq(externalStorageConnectionsTable.id, connection.id));
    await updateSyncJob(jobId, { status: "completed", progress: 100, completedAt: new Date() });
    await evictExternalContentCacheIfNeeded().catch(() => undefined);
  } catch (e) {
    if (e instanceof SyncControlledStop) {
      // Пауза/отмена: статус уже выставлен, фиксируем накопленные счётчики.
      await updateSyncJob(jobId, { completedAt: e.jobStatus === "cancelled" ? new Date() : null });
      return;
    }
    const isAuthError = e instanceof ExternalStorageError && e.kind === "auth";
    const message = e instanceof Error ? e.message : "Синхронизация не удалась";
    await markConnectionStatus(connection.id, isAuthError ? "auth_error" : "error", message);
    await updateSyncJob(jobId, { status: "failed", errorMessage: message, completedAt: new Date() });
  }
}

async function syncConnection(
  connection: ExternalStorageConnection,
  jobId: number,
  owner: { id: number; analyticsOptIn: boolean } | undefined,
): Promise<void> {
  // Управление (пауза/отмена) читается из статуса джобы между файлами.
  const assertControlled = async (): Promise<void> => {
    const [row] = await db
      .select({ status: externalSyncJobsTable.status })
      .from(externalSyncJobsTable)
      .where(eq(externalSyncJobsTable.id, jobId));
    if (row?.status === "paused" || row?.status === "cancelled") {
      throw new SyncControlledStop(row.status);
    }
  };

  const { credentials } = await loadConnectionCredentials(connection);
  const files = await collectExternalBookFiles(credentials, connection.rootFolder, assertControlled);
  await updateSyncJob(jobId, { filesFound: files.length, progress: 10 });

  // Книги этого провайдера пользователя: привязанные к подключению и
  // осиротевшие (хранилище отключали) — вторые повторно привязываем по пути.
  const existingBooks = await db
    .select({
      id: booksTable.id,
      externalConnectionId: booksTable.externalConnectionId,
      externalPath: booksTable.externalPath,
      externalEtag: booksTable.externalEtag,
      externalModifiedAt: booksTable.externalModifiedAt,
      fileSize: booksTable.fileSize,
      coverPath: booksTable.coverPath,
      externalMissing: booksTable.externalMissing,
    })
    .from(booksTable)
    .where(
      and(
        eq(booksTable.ownerUserId, connection.ownerUserId),
        eq(booksTable.externalProvider, connection.provider),
        or(eq(booksTable.externalConnectionId, connection.id), isNull(booksTable.externalConnectionId)),
      ),
    );
  const byPath = new Map(existingBooks.map((book) => [book.externalPath ?? "", book]));

  let imported = 0;
  let updated = 0;
  let missing = 0;
  let failed = 0;
  let recordedFailures = 0;
  const seenPaths = new Set<string>();

  for (let i = 0; i < files.length; i++) {
    await assertControlled();
    const { entry, format, explicitZip } = files[i];
    seenPaths.add(entry.path);
    const existing = byPath.get(entry.path);
    if (existing && existing.externalConnectionId === connection.id && isEntryUnchanged(existing, entry)) {
      if (existing.externalMissing) {
        await db.update(booksTable).set({ externalMissing: false }).where(eq(booksTable.id, existing.id));
      }
      await updateSyncJob(jobId, { progress: 10 + Math.round(((i + 1) / files.length) * 90) });
      continue;
    }

    try {
      if (i > 0) await sleep(DOWNLOAD_DELAY_MS);
      // Touch джобы перед потенциально долгим скачиванием, чтобы контроль
      // зависания (10 минут без обновлений) не сработал ложно.
      await updateSyncJob(jobId, { updatedAt: new Date() });
      const buffer = await downloadExternalFile(credentials, entry.path);
      const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");

      // Дедупликация по содержимому для новых файлов: книга с тем же fileHash
      // уже в библиотеке — не создаём копию (прогресс и заметки остаются).
      if (!existing) {
        const duplicate = await findBookByFileHash(connection.ownerUserId, fileHash);
        if (duplicate) {
          const kind = classifyHashDuplicate(duplicate, connection);
          if (kind === "candidate") {
            await db
              .insert(externalBookRelocationsTable)
              .values({
                connectionId: connection.id,
                ownerUserId: connection.ownerUserId,
                bookId: duplicate.id,
                externalPath: entry.path.slice(0, FAILURE_PATH_MAX),
                fileName: entry.name.slice(0, FAILURE_NAME_MAX),
                fileSize: buffer.byteLength,
                etag: entry.etag,
              })
              .onConflictDoUpdate({
                target: [externalBookRelocationsTable.connectionId, externalBookRelocationsTable.bookId],
                set: {
                  externalPath: entry.path.slice(0, FAILURE_PATH_MAX),
                  fileName: entry.name.slice(0, FAILURE_NAME_MAX),
                  fileSize: buffer.byteLength,
                  etag: entry.etag,
                },
                setWhere: eq(externalBookRelocationsTable.status, "pending"),
              });
          } else if (kind === "attach") {
            // Книга этого провайдера: тихая (пере)привязка к файлу по пути.
            await db
              .update(booksTable)
              .set({
                externalConnectionId: connection.id,
                externalPath: entry.path,
                externalEtag: entry.etag,
                externalModifiedAt: entry.modifiedAt,
                externalMissing: false,
                fileSize: buffer.byteLength,
                ...(isExternalStorageKey(duplicate.storageKey)
                  ? { storageKey: externalStorageKey(connection.id, entry.path) }
                  : {}),
              })
              .where(eq(booksTable.id, duplicate.id));
          } else {
            throw new SyncDuplicateError();
          }
          await updateSyncJob(jobId, { progress: 10 + Math.round(((i + 1) / files.length) * 90) });
          continue;
        }
      }

      // fb2 в zip-контейнере: разворачиваем до XML. Произвольный .zip без
      // книги — не книга, пропускаем молча; для явных .fbz/.fb2.zip это ошибка.
      let parseBuffer = buffer;
      if (format === "fb2" && isZipBuffer(buffer)) {
        const xml = extractFb2FromZip(buffer);
        if (xml === null) {
          if (!explicitZip) {
            await updateSyncJob(jobId, { progress: 10 + Math.round(((i + 1) / files.length) * 90) });
            continue;
          }
          throw new Error("ZIP-архив не содержит книгу FB2");
        }
        parseBuffer = xml;
      }
      const parsed = parseBook(parseBuffer, format, SYNC_PARSE_OPTIONS);
      const contentBytes = chaptersContentBytes(parsed.chapters.map((ch) => ch.htmlContent));

      if (existing) {
        const newCoverPath = parsed.coverBase64
          ? await storeOptimizedCover(Buffer.from(parsed.coverBase64, "base64"), `book-${existing.id}`)
          : null;
        const oldCoverPath = newCoverPath && newCoverPath !== existing.coverPath ? existing.coverPath : null;
        const seriesCycle = await resolveCycleFromSeries(connection.ownerUserId, parsed.seriesName ?? null);

        await db
          .update(booksTable)
          .set({
            title: parsed.title,
            author: parsed.author,
            description: parsed.description,
            language: parsed.language,
            publicationYear: parsed.publicationYear,
            coverPath: newCoverPath ?? existing.coverPath,
            fileHash,
            fileSize: buffer.byteLength,
            externalConnectionId: connection.id,
            externalEtag: entry.etag,
            externalModifiedAt: entry.modifiedAt,
            externalMissing: false,
            contentCacheBytes: contentBytes,
            contentAccessedAt: new Date(),
            ...(parsed.seriesName
              ? {
                  cycleId: seriesCycle.cycleId,
                  cycleName: seriesCycle.cycleName,
                  cycleNumber: parsed.seriesNumber ?? null,
                }
              : {}),
          })
          .where(eq(booksTable.id, existing.id));
        await upsertBookChapters(existing.id, parsed.chapters);
        await db.delete(bookGenresTable).where(eq(bookGenresTable.bookId, existing.id));
        await applyGenres(existing.id, parsed.genres);
        if (oldCoverPath) await deleteCoverIfUnreferenced(oldCoverPath, [existing.id]);
        updated++;
      } else {
        const coverPath = parsed.coverBase64
          ? await storeOptimizedCover(Buffer.from(parsed.coverBase64, "base64"), fileHash)
          : null;
        const seriesCycle = await resolveCycleFromSeries(connection.ownerUserId, parsed.seriesName ?? null);
        const [book] = await db
          .insert(booksTable)
          .values({
            ownerUserId: connection.ownerUserId,
            title: parsed.title,
            author: parsed.author,
            description: parsed.description,
            language: parsed.language,
            publicationYear: parsed.publicationYear,
            coverPath,
            format,
            storageKey: externalStorageKey(connection.id, entry.path),
            fileHash,
            fileSize: buffer.byteLength,
            cycleId: seriesCycle.cycleId,
            cycleName: seriesCycle.cycleName,
            cycleNumber: parsed.seriesNumber ?? null,
            externalConnectionId: connection.id,
            externalProvider: connection.provider,
            externalPath: entry.path,
            externalEtag: entry.etag,
            externalModifiedAt: entry.modifiedAt,
            contentCacheBytes: contentBytes,
            contentAccessedAt: new Date(),
          })
          .returning();
        await db.insert(chaptersTable).values(chaptersTableValues(parsed.chapters, book.id));
        await applyGenres(book.id, parsed.genres);
        imported++;
        if (owner) {
          await recordServerAnalyticsEvent(owner, {
            bookId: book.id,
            eventName: "book_added",
            properties: { format, source: "external_sync" },
          }).catch(() => undefined);
        }
      }
    } catch (e) {
      if (e instanceof ExternalStorageError && e.kind === "auth") throw e;
      failed++;
      const reason = e instanceof ExternalStorageError ? "download" : e instanceof SyncDuplicateError ? "duplicate" : "parse";
      if (recordedFailures < MAX_FAILURES_PER_SYNC) {
        recordedFailures++;
        await recordSyncFailure(jobId, entry, e, reason).catch(() => undefined);
      }
    }
    await updateSyncJob(jobId, {
      progress: 10 + Math.round(((i + 1) / files.length) * 90),
      filesImported: imported,
      filesUpdated: updated,
      filesFailed: failed,
    });
  }

  await assertControlled();
  for (const book of existingBooks) {
    if (book.externalConnectionId === connection.id && book.externalPath && !seenPaths.has(book.externalPath)) {
      await db.update(booksTable).set({ externalMissing: true }).where(eq(booksTable.id, book.id));
      missing++;
    }
  }

  await updateSyncJob(jobId, { filesImported: imported, filesUpdated: updated, filesMissing: missing, filesFailed: failed });
}

function chaptersTableValues(
  chapters: { index: number; title: string; htmlContent: string; wordCount: number | null }[],
  bookId: number,
) {
  return chapters.map((ch) => ({ bookId, ...ch }));
}
