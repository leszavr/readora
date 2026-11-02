import { pgEnum, pgTable, serial, bigserial, integer, text, timestamp, real, index, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { booksTable } from "./books";

export const externalStorageProviderEnum = pgEnum("external_storage_provider", ["yandex_disk", "mail_ru_cloud"]);
export const externalConnectionStatusEnum = pgEnum("external_connection_status", ["active", "auth_error", "error"]);
export const externalSyncJobStatusEnum = pgEnum("external_sync_job_status", ["queued", "processing", "paused", "cancelled", "completed", "failed"]);

// Подключение внешнего хранилища пользователя. Креды — только в зашифрованном
// виде (credentialsEncrypted), никогда не логируются и не отдаются в API.
export const externalStorageConnectionsTable = pgTable(
  "external_storage_connections",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    provider: externalStorageProviderEnum("provider").notNull(),
    credentialsEncrypted: text("credentials_encrypted").notNull(),
    rootFolder: text("root_folder").notNull().default("/"),
    status: externalConnectionStatusEnum("status").notNull().default("active"),
    lastError: text("last_error"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index("external_storage_connections_owner_idx").on(t.ownerUserId),
    uniqueIndex("external_storage_connections_owner_provider_uidx").on(t.ownerUserId, t.provider),
  ],
);

// Джоба синхронизации: скан rootFolder подключения, импорт/обновление книг.
export const externalSyncJobsTable = pgTable(
  "external_sync_jobs",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connection_id").notNull().references(() => externalStorageConnectionsTable.id, { onDelete: "cascade" }),
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    status: externalSyncJobStatusEnum("status").notNull().default("queued"),
    progress: real("progress").notNull().default(0),
    filesFound: integer("files_found").notNull().default(0),
    filesImported: integer("files_imported").notNull().default(0),
    filesUpdated: integer("files_updated").notNull().default(0),
    filesMissing: integer("files_missing").notNull().default(0),
    filesFailed: integer("files_failed").notNull().default(0),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    index("external_sync_jobs_connection_idx").on(t.connectionId),
    index("external_sync_jobs_owner_created_idx").on(t.ownerUserId, t.createdAt),
  ],
);

// Причины ошибок при импорте файла: проблема скачивания из хранилища,
// проблема обработки содержимого (парсинг, лимиты) или байтовый дубликат.
export const externalSyncFailureReasonEnum = pgEnum("external_sync_failure_reason", ["download", "parse", "duplicate"]);

// Детализация ошибок джобы синхронизации: какие файлы упали и почему.
// Записи ограничены (см. MAX_FAILURES_PER_SYNC в api-server), счётчик filesFailed
// в джобе всегда точный.
export const externalSyncJobFailuresTable = pgTable(
  "external_sync_job_failures",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    jobId: integer("job_id").notNull().references(() => externalSyncJobsTable.id, { onDelete: "cascade" }),
    externalPath: text("external_path").notNull(),
    fileName: text("file_name").notNull(),
    reason: externalSyncFailureReasonEnum("reason").notNull(),
    errorMessage: text("error_message").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("external_sync_job_failures_job_idx").on(t.jobId)],
);

// Источник книги во внешнем хранилище: файл остаётся в облаке, на сервере —
// метаданные, скелет глав и оперативный кэш контента (contentCacheBytes,
// выселяемый по LRU). externalProvider дублируется в books, чтобы при
// отключении соединения (externalConnectionId -> null) и повторном
// подключении книги можно было привязать обратно по пути файла.
export type ExternalStorageProvider = (typeof externalStorageProviderEnum.enumValues)[number];
export type ExternalStorageConnection = (typeof externalStorageConnectionsTable.$inferSelect);
export type ExternalSyncJob = typeof externalSyncJobsTable.$inferSelect;
export type ExternalSyncJobFailure = typeof externalSyncJobFailuresTable.$inferSelect;

// Кандидат на переезд локальной книги в облако: синхронизация нашла файл
// с тем же fileHash, что у загруженной вручную книги. После подтверждения
// пользователем книга привязывается к облаку, файл удаляется с сервера.
export const externalRelocationStatusEnum = pgEnum("external_relocation_status", ["pending", "migrated", "dismissed"]);

export const externalBookRelocationsTable = pgTable(
  "external_book_relocations",
  {
    id: serial("id").primaryKey(),
    connectionId: integer("connection_id").notNull().references(() => externalStorageConnectionsTable.id, { onDelete: "cascade" }),
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    bookId: integer("book_id").notNull().references((): AnyPgColumn => booksTable.id, { onDelete: "cascade" }),
    externalPath: text("external_path").notNull(),
    fileName: text("file_name").notNull(),
    fileSize: integer("file_size").notNull().default(0),
    etag: text("etag"),
    status: externalRelocationStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("external_book_relocations_connection_book_uidx").on(t.connectionId, t.bookId)],
);

export type ExternalBookRelocation = typeof externalBookRelocationsTable.$inferSelect;
