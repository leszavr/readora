import { and, asc, eq, isNotNull, sql } from "drizzle-orm";
import {
  appSettingsTable,
  booksTable,
  chaptersTable,
  db,
  externalStorageConnectionsTable,
  type Book,
} from "@workspace/db";
import { parseBook, type BookFormat } from "../parser";
import { downloadExternalFile, ExternalStorageError } from "./drivers";
import { loadConnectionCredentials } from "./connections";
import { isExternalStorageEnabled, externalStorageDisabledMessage } from "./feature";

// Оперативный кэш контента внешних книг: при открытии книги контент глав
// восстанавливается из облака (файл не хранится на сервере постоянно), при
// превышении глобального бюджета — выселяется по LRU (html_content глав
// обнуляется, скелет строк и стабильные id глав сохраняются).

const CACHE_BUDGET_SETTING_KEY = "externalCacheBudgetMb";
const DEFAULT_CACHE_BUDGET_MB = 2048;
const ACCESSED_AT_REFRESH_MS = 60 * 60 * 1000;

// Единственное место задания лимита — настройка externalCacheBudgetMb в
// админке: без верхнего предела, чтобы при переезде на больший диск не было
// бутылочного горлышка. Некорректное значение — откат к дефолту.
function parseBudgetMb(value: string | null | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_BUDGET_MB;
}

export async function getExternalCacheBudgetBytes(): Promise<number> {
  const [row] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, CACHE_BUDGET_SETTING_KEY));
  return parseBudgetMb(row?.value) * 1024 * 1024;
}

export function chaptersContentBytes(htmlContents: string[]): number {
  return htmlContents.reduce((sum, html) => sum + Buffer.byteLength(html, "utf8"), 0);
}

// Обновляет главы книги по index: существующие строки — на месте (стабильные id
// для закладок/заметок/прогресса), недостающие — вставляются, излишние —
// удаляются (каскад затрагивает только аннотации исчезнувших глав).
export async function upsertBookChapters(bookId: number, parsedChapters: { index: number; title: string; htmlContent: string; wordCount: number | null }[]): Promise<void> {
  const existing = await db
    .select({ id: chaptersTable.id, index: chaptersTable.index })
    .from(chaptersTable)
    .where(eq(chaptersTable.bookId, bookId));
  const existingByIndex = new Map(existing.map((row) => [row.index, row.id]));

  for (const chapter of parsedChapters) {
    const existingId = existingByIndex.get(chapter.index);
    if (existingId) {
      await db
        .update(chaptersTable)
        .set({ title: chapter.title, htmlContent: chapter.htmlContent, wordCount: chapter.wordCount })
        .where(eq(chaptersTable.id, existingId));
      existingByIndex.delete(chapter.index);
    } else {
      await db.insert(chaptersTable).values({ bookId, ...chapter });
    }
  }

  const surplusIds = [...existingByIndex.values()];
  if (surplusIds.length > 0) {
    await db.delete(chaptersTable).where(sql`${chaptersTable.id} in ${sql.join(surplusIds.map((id) => sql`${id}`), sql`, `)}`);
  }
}

async function restoreBookContent(book: Book): Promise<number> {
  if (!book.externalConnectionId) {
    throw new ExternalStorageError("not_found", "Хранилище книги отключено. Подключите его снова в настройках профиля.");
  }
  const [connection] = await db
    .select()
    .from(externalStorageConnectionsTable)
    .where(eq(externalStorageConnectionsTable.id, book.externalConnectionId));
  if (!connection) {
    throw new ExternalStorageError("not_found", "Хранилище книги не найдено. Подключите его снова в настройках профиля.");
  }

  const { credentials } = await loadConnectionCredentials(connection);
  const buffer = await downloadExternalFile(credentials, book.externalPath ?? "/");
  const parsed = parseBook(buffer, book.format as BookFormat, { sizeLimits: { maxFileBytes: null } });
  await upsertBookChapters(book.id, parsed.chapters);
  return chaptersContentBytes(parsed.chapters.map((ch) => ch.htmlContent));
}

// Скачивание оригинала внешней книги из облака (для админ-проверки парсинга).
export async function downloadExternalBookFile(book: Book): Promise<Buffer> {
  if (!book.externalConnectionId || !book.externalPath) {
    throw new ExternalStorageError("not_found", "Книга не привязана к внешнему хранилищу");
  }
  const [connection] = await db
    .select()
    .from(externalStorageConnectionsTable)
    .where(eq(externalStorageConnectionsTable.id, book.externalConnectionId));
  if (!connection) {
    throw new ExternalStorageError("not_found", "Хранилище книги отключено");
  }
  const { credentials } = await loadConnectionCredentials(connection);
  return downloadExternalFile(credentials, book.externalPath);
}

// Гарантирует наличие контента глав внешней книги (канонической для подарочных
// копий). Для обычных книг — no-op: их контент всегда в БД.
export async function ensureBookContentCached(bookId: number): Promise<void> {
  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, bookId));
  if (!book || !book.externalProvider || !book.externalPath) return;

  const canonicalId = book.contentBookId ?? book.id;
  if (canonicalId !== book.id) {
    await ensureBookContentCached(canonicalId);
    return;
  }

  if (!(await isExternalStorageEnabled())) {
    throw new ExternalStorageError("not_found", externalStorageDisabledMessage());
  }

  if (book.contentCacheBytes > 0) {
    if (!book.contentAccessedAt || Date.now() - book.contentAccessedAt.getTime() > ACCESSED_AT_REFRESH_MS) {
      await db.update(booksTable).set({ contentAccessedAt: new Date() }).where(eq(booksTable.id, book.id));
    }
    return;
  }

  const contentBytes = await restoreBookContent(book);
  await db
    .update(booksTable)
    .set({ contentCacheBytes: contentBytes, contentAccessedAt: new Date(), externalMissing: false })
    .where(eq(booksTable.id, book.id));

  await evictExternalContentCacheIfNeeded().catch(() => undefined);
}

// Выселение контента внешних книг по LRU до глобального бюджета.
export async function evictExternalContentCacheIfNeeded(): Promise<void> {
  const budgetBytes = await getExternalCacheBudgetBytes();
  const [totalRow] = await db
    .select({ total: sql<number>`coalesce(sum(${booksTable.contentCacheBytes}), 0)::bigint` })
    .from(booksTable)
    .where(and(isNotNull(booksTable.externalProvider), sql`${booksTable.contentCacheBytes} > 0`));
  let total = Number(totalRow?.total ?? 0);
  if (total <= budgetBytes) return;

  const candidates = await db
    .select({ id: booksTable.id, bytes: booksTable.contentCacheBytes })
    .from(booksTable)
    .where(and(isNotNull(booksTable.externalProvider), sql`${booksTable.contentCacheBytes} > 0`))
    .orderBy(asc(booksTable.contentAccessedAt));

  for (const candidate of candidates) {
    if (total <= budgetBytes) break;
    await db
      .update(chaptersTable)
      .set({ htmlContent: "" })
      .where(eq(chaptersTable.bookId, candidate.id));
    await db
      .update(booksTable)
      .set({ contentCacheBytes: 0 })
      .where(eq(booksTable.id, candidate.id));
    total -= candidate.bytes;
  }
}
