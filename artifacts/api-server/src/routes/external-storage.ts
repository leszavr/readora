import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  booksTable,
  db,
  externalStorageConnectionsTable,
  externalSyncJobFailuresTable,
  externalSyncJobsTable,
  usersTable,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { encryptCredentials, isExternalStorageCryptoConfigured } from "../lib/external-storage/crypto";
import {
  listExternalFolder,
  ExternalStorageError,
  type ExternalCredentials,
} from "../lib/external-storage/drivers";
import {
  getOwnedConnection,
  loadConnectionCredentials,
  markConnectionStatus,
} from "../lib/external-storage/connections";
import {
  runExternalSyncJob,
  failStaleActiveSyncJobs,
  applySyncJobControl,
} from "../lib/external-storage/sync";
import {
  isValidRelocationAction,
  listPendingRelocations,
  resolveExternalRelocation,
} from "../lib/external-storage/relocations";
import { isExternalStorageEnabled, externalStorageDisabledMessage } from "../lib/external-storage/feature";

const router = Router();
type AuthReq = Request & { user: typeof usersTable.$inferSelect };

const MAILRU_LOGIN_MAX = 200;
const MAILRU_PASSWORD_MAX = 200;
const FOLDER_PATH_MAX = 2000;

function providerLabel(provider: "yandex_disk" | "mail_ru_cloud"): string {
  return provider === "yandex_disk" ? "Яндекс.Диск" : "Облако Mail.ru";
}

function requireCryptoConfigured(res: Response): boolean {
  if (isExternalStorageCryptoConfigured()) return true;
  res.status(503).json({ error: "Подключение внешних хранилищ не настроено на сервере" });
  return false;
}

async function requireFeatureEnabled(res: Response): Promise<boolean> {
  if (await isExternalStorageEnabled()) return true;
  res.status(503).json({ error: externalStorageDisabledMessage() });
  return false;
}

async function connectionResponse(userId: number, connectionId: number) {
  const [connection] = await db
    .select()
    .from(externalStorageConnectionsTable)
    .where(and(eq(externalStorageConnectionsTable.id, connectionId), eq(externalStorageConnectionsTable.ownerUserId, userId)));
  if (!connection) return null;

  const [counts, activeJob] = await Promise.all([
    db
      .select({
        books: sql<number>`count(*)::int`,
        missing: sql<number>`count(*) filter (where ${booksTable.externalMissing})::int`,
      })
      .from(booksTable)
      .where(and(eq(booksTable.ownerUserId, userId), eq(booksTable.externalConnectionId, connection.id))),
    db
      .select({ id: externalSyncJobsTable.id, status: externalSyncJobsTable.status })
      .from(externalSyncJobsTable)
      .where(and(
        eq(externalSyncJobsTable.connectionId, connection.id),
        inArray(externalSyncJobsTable.status, ["queued", "processing", "paused"]),
      ))
      .orderBy(desc(externalSyncJobsTable.id))
      .limit(1),
  ]);

  return {
    id: connection.id,
    provider: connection.provider,
    providerLabel: providerLabel(connection.provider),
    rootFolder: connection.rootFolder,
    status: connection.status,
    lastError: connection.lastError,
    lastSyncedAt: connection.lastSyncedAt,
    createdAt: connection.createdAt,
    booksCount: counts[0]?.books ?? 0,
    missingBooksCount: counts[0]?.missing ?? 0,
    activeSyncJobId: activeJob[0]?.id ?? null,
    activeSyncJobStatus: activeJob[0]?.status ?? null,
  };
}

// GET /external-storage/feature-status — включена ли функция внешних хранилищ
router.get("/external-storage/feature-status", requireAuth, async (_req, res): Promise<void> => {
  res.json({ enabled: await isExternalStorageEnabled() });
});

// GET /external-storage/connections — подключения пользователя (без секретов)
router.get("/external-storage/connections", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  await failStaleActiveSyncJobs();
  const connections = await db
    .select({ id: externalStorageConnectionsTable.id })
    .from(externalStorageConnectionsTable)
    .where(eq(externalStorageConnectionsTable.ownerUserId, user.id))
    .orderBy(externalStorageConnectionsTable.id);

  const list = [];
  for (const { id } of connections) {
    const item = await connectionResponse(user.id, id);
    if (item) list.push(item);
  }
  res.json(list);
});

// POST /external-storage/connections/mailru — подключение Облака Mail.ru (WebDAV + app-password)
router.post("/external-storage/connections/mailru", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!(await requireFeatureEnabled(res)) || !requireCryptoConfigured(res)) return;

  const { login, appPassword, rootFolder } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof login !== "string" || !login.trim() || login.length > MAILRU_LOGIN_MAX) {
    res.status(400).json({ error: "Укажите логин Mail.ru" });
    return;
  }
  if (typeof appPassword !== "string" || !appPassword || appPassword.length > MAILRU_PASSWORD_MAX) {
    res.status(400).json({ error: "Укажите пароль приложения Mail.ru" });
    return;
  }
  const folder = typeof rootFolder === "string" && rootFolder.trim() ? rootFolder.trim().slice(0, FOLDER_PATH_MAX) : "/";

  const credentials: ExternalCredentials = {
    provider: "mail_ru_cloud",
    login: login.trim(),
    appPassword,
  };
  try {
    await listExternalFolder(credentials, "/");
  } catch (e) {
    if (e instanceof ExternalStorageError && (e.kind === "auth" || e.kind === "network")) {
      res.status(400).json({ error: "Не удалось подключиться к Облаку Mail.ru: проверьте логин и пароль приложения" });
      return;
    }
    throw e;
  }

  const encrypted = encryptCredentials(credentials);
  const [existing] = await db
    .select({ id: externalStorageConnectionsTable.id })
    .from(externalStorageConnectionsTable)
    .where(and(eq(externalStorageConnectionsTable.ownerUserId, user.id), eq(externalStorageConnectionsTable.provider, "mail_ru_cloud")));

  const connectionId = existing
    ? (
        await db
          .update(externalStorageConnectionsTable)
          .set({ credentialsEncrypted: encrypted, rootFolder: folder, status: "active", lastError: null })
          .where(eq(externalStorageConnectionsTable.id, existing.id))
          .returning({ id: externalStorageConnectionsTable.id })
      )[0].id
    : (
        await db
          .insert(externalStorageConnectionsTable)
          .values({ ownerUserId: user.id, provider: "mail_ru_cloud", credentialsEncrypted: encrypted, rootFolder: folder })
          .returning({ id: externalStorageConnectionsTable.id })
      )[0].id;

  res.status(existing ? 200 : 201).json(await connectionResponse(user.id, connectionId));
});

// PATCH /external-storage/connections/:id — смена папки синхронизации
router.patch("/external-storage/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const connectionId = Number.parseInt(String(req.params.id), 10);
  const connection = await getOwnedConnection(user.id, connectionId);
  if (!connection) { res.status(404).json({ error: "Подключение не найдено" }); return; }

  const { rootFolder } = (req.body ?? {}) as Record<string, unknown>;
  if (typeof rootFolder !== "string" || !rootFolder.trim() || rootFolder.length > FOLDER_PATH_MAX) {
    res.status(400).json({ error: "Укажите папку" });
    return;
  }
  const folder = rootFolder.trim();
  try {
    const { credentials } = await loadConnectionCredentials(connection);
    await listExternalFolder(credentials, folder);
  } catch (e) {
    if (e instanceof ExternalStorageError && e.kind === "not_found") {
      res.status(400).json({ error: "Папка не найдена в хранилище" });
      return;
    }
    throw e;
  }

  await db
    .update(externalStorageConnectionsTable)
    .set({ rootFolder: folder })
    .where(eq(externalStorageConnectionsTable.id, connection.id));
  res.json(await connectionResponse(user.id, connection.id));
});

// DELETE /external-storage/connections/:id — отключить хранилище.
// Книги, прогресс и заметки сохраняются: при повторном подключении того же
// провайдера книги привязываются обратно по пути файла.
router.delete("/external-storage/connections/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const connectionId = Number.parseInt(String(req.params.id), 10);
  const connection = await getOwnedConnection(user.id, connectionId);
  if (!connection) { res.status(404).json({ error: "Подключение не найдено" }); return; }

  await db.delete(externalStorageConnectionsTable).where(eq(externalStorageConnectionsTable.id, connection.id));
  res.json({ ok: true });
});

// GET /external-storage/connections/:id/folders?path= — список подпапок для выбора папки
router.get("/external-storage/connections/:id/folders", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!(await requireFeatureEnabled(res))) return;
  const connectionId = Number.parseInt(String(req.params.id), 10);
  const connection = await getOwnedConnection(user.id, connectionId);
  if (!connection) { res.status(404).json({ error: "Подключение не найдено" }); return; }

  const rawPath = typeof req.query.path === "string" ? req.query.path : "/";
  const folderPath = (rawPath || "/").slice(0, FOLDER_PATH_MAX);

  try {
    const { credentials } = await loadConnectionCredentials(connection);
    const entries = await listExternalFolder(credentials, folderPath);
    res.json({
      path: folderPath,
      folders: entries
        .filter((entry) => entry.isDir)
        .map((entry) => ({ name: entry.name, path: entry.path }))
        .sort((a, b) => a.name.localeCompare(b.name, "ru")),
    });
  } catch (e) {
    if (e instanceof ExternalStorageError) {
      if (e.kind === "auth") await markConnectionStatus(connection.id, "auth_error", e.message);
      const status = e.kind === "auth" ? 401 : e.kind === "not_found" ? 404 : 502;
      res.status(status).json({ error: e.message });
      return;
    }
    throw e;
  }
});

// POST /external-storage/connections/:id/sync — запустить синхронизацию
router.post("/external-storage/connections/:id/sync", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!(await requireFeatureEnabled(res))) return;
  const connectionId = Number.parseInt(String(req.params.id), 10);
  const connection = await getOwnedConnection(user.id, connectionId);
  if (!connection) { res.status(404).json({ error: "Подключение не найдено" }); return; }

  await failStaleActiveSyncJobs();
  const [activeJob] = await db
    .select({ id: externalSyncJobsTable.id })
    .from(externalSyncJobsTable)
    .where(and(
      eq(externalSyncJobsTable.connectionId, connection.id),
      inArray(externalSyncJobsTable.status, ["queued", "processing", "paused"]),
    ));
  if (activeJob) {
    res.status(409).json({ error: "Синхронизация уже выполняется", jobId: activeJob.id });
    return;
  }

  const [job] = await db
    .insert(externalSyncJobsTable)
    .values({ connectionId: connection.id, ownerUserId: user.id, status: "queued" })
    .returning();

  setImmediate(() => {
    runExternalSyncJob(job.id).catch((error) => {
      console.error("External sync job failed:", error instanceof Error ? error.message : error);
    });
  });

  res.status(202).json(toSyncJobResponse(job));
});

// GET /external-storage/connections/:id/relocations — книги, которые можно
// перенести в облако (найдены локальные копии с тем же содержимым).
router.get("/external-storage/connections/:id/relocations", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!(await requireFeatureEnabled(res))) return;
  const connectionId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(connectionId)) { res.status(400).json({ error: "Некорректный id подключения" }); return; }
  const connection = await getOwnedConnection(user.id, connectionId);
  if (!connection) { res.status(404).json({ error: "Подключение не найдено" }); return; }

  const items = await listPendingRelocations(user.id, connection.id);
  res.json({
    items: items.map((item) => ({
      id: item.id,
      bookId: item.bookId,
      bookTitle: item.bookTitle,
      bookAuthor: item.bookAuthor,
      fileName: item.fileName,
      externalPath: item.externalPath,
      fileSize: item.fileSize,
      createdAt: item.createdAt,
    })),
  });
});

// POST /external-storage/relocations/:id/resolve — перенести книгу в облако
// (migrate) или отказаться (dismiss).
router.post("/external-storage/relocations/:id/resolve", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!(await requireFeatureEnabled(res))) return;
  const relocationId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(relocationId)) { res.status(400).json({ error: "Некорректный id" }); return; }

  const { action } = (req.body ?? {}) as Record<string, unknown>;
  if (!isValidRelocationAction(action)) {
    res.status(400).json({ error: "Недействительное действие (migrate или dismiss)" });
    return;
  }

  const result = await resolveExternalRelocation(relocationId, user.id, action);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({
    id: result.relocation.id,
    connectionId: result.relocation.connectionId,
    bookId: result.relocation.bookId,
    status: result.relocation.status,
    resolvedAt: result.relocation.resolvedAt,
  });
});

// GET /external-storage/sync-jobs/:id — статус синхронизации
router.get("/external-storage/sync-jobs/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!(await requireFeatureEnabled(res))) return;
  const jobId = Number.parseInt(String(req.params.id), 10);
  await failStaleActiveSyncJobs();
  const [job] = await db
    .select()
    .from(externalSyncJobsTable)
    .where(and(eq(externalSyncJobsTable.id, jobId), eq(externalSyncJobsTable.ownerUserId, user.id)));
  if (!job) { res.status(404).json({ error: "Задача синхронизации не найдена" }); return; }
  res.json(toSyncJobResponse(job));
});

// GET /external-storage/sync-jobs/:id/failures — детализация ошибок синхронизации:
// какие файлы упали и почему (первые 500 записей, счётчик filesFailed точный).
router.get("/external-storage/sync-jobs/:id/failures", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!(await requireFeatureEnabled(res))) return;
  const jobId = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(jobId)) { res.status(400).json({ error: "Некорректный id задачи" }); return; }

  const [job] = await db
    .select({ id: externalSyncJobsTable.id })
    .from(externalSyncJobsTable)
    .where(and(eq(externalSyncJobsTable.id, jobId), eq(externalSyncJobsTable.ownerUserId, user.id)));
  if (!job) { res.status(404).json({ error: "Задача синхронизации не найдена" }); return; }

  const rows = await db
    .select({
      externalPath: externalSyncJobFailuresTable.externalPath,
      fileName: externalSyncJobFailuresTable.fileName,
      reason: externalSyncJobFailuresTable.reason,
      errorMessage: externalSyncJobFailuresTable.errorMessage,
      createdAt: externalSyncJobFailuresTable.createdAt,
    })
    .from(externalSyncJobFailuresTable)
    .where(eq(externalSyncJobFailuresTable.jobId, jobId))
    .orderBy(externalSyncJobFailuresTable.id)
    .limit(500);

  res.json({
    items: rows.map((row) => ({
      externalPath: row.externalPath,
      fileName: row.fileName,
      reason: row.reason,
      errorMessage: row.errorMessage,
      createdAt: row.createdAt,
    })),
  });
});

// PATCH /external-storage/sync-jobs/:id — пауза/возобновление/отмена синхронизации
router.patch("/external-storage/sync-jobs/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!(await requireFeatureEnabled(res))) return;
  const jobId = Number.parseInt(String(req.params.id), 10);
  const result = await applySyncJobControl(jobId, user.id, (req.body ?? {}).action);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(toSyncJobResponse(result.job));
});

function toSyncJobResponse(job: typeof externalSyncJobsTable.$inferSelect) {
  return {
    id: job.id,
    connectionId: job.connectionId,
    status: job.status,
    progress: Math.round(job.progress),
    filesFound: job.filesFound,
    filesImported: job.filesImported,
    filesUpdated: job.filesUpdated,
    filesMissing: job.filesMissing,
    filesFailed: job.filesFailed,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}

// --- Яндекс.Диск: OAuth-подключение (отдельно от входа, scope Диска) ---
// Используется тот же Callback URL, что и вход через Яндекс
// (/api/auth/yandex/callback): в приложении Яндекса зарегистрирован один
// redirect_uri, поэтому потоки различаются по state в сессии.

const YANDEX_AUTH_BASE = "https://oauth.yandex.ru";
const YANDEX_DISK_SCOPES = "cloud_api:disk.read";
const YANDEX_SHARED_CALLBACK_PATH = "/api/auth/yandex/callback";

function getYandexEnv(): { clientId: string } | null {
  const clientId = process.env.YANDEX_CLIENT_ID;
  return clientId ? { clientId } : null;
}

router.get("/external-storage/yandex/connect", requireAuth, async (req, res): Promise<void> => {
  if (!(await requireFeatureEnabled(res)) || !requireCryptoConfigured(res)) return;
  const env = getYandexEnv();
  if (!env) {
    res.status(503).json({ error: "Подключение Яндекс.Диска не настроено на сервере" });
    return;
  }
  const state = crypto.randomUUID();
  req.session.yandexDiskConnectState = state;
  const appOrigin = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: `${appOrigin}${YANDEX_SHARED_CALLBACK_PATH}`,
    scope: YANDEX_DISK_SCOPES,
    state,
  });
  res.redirect(`${YANDEX_AUTH_BASE}/authorize?${params.toString()}`);
});

export default router;
