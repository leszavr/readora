import { index, pgTable, text, serial, integer, timestamp, pgEnum, real, boolean, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { cyclesTable } from "./cycles";
import { externalStorageConnectionsTable, externalStorageProviderEnum } from "./external-storage";

export const bookFormatEnum = pgEnum("book_format", ["fb2", "epub", "mobi", "cbz", "txt", "md", "html"]);
export const bookStatusEnum = pgEnum("book_status", ["active", "blocked"]);

export const booksTable = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    ownerUserId: integer("owner_user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    author: text("author"),
    description: text("description"),
    coverPath: text("cover_path"),
    format: bookFormatEnum("format").notNull(),
    language: text("language"),
    publicationYear: integer("publication_year"),
    cycleId: integer("cycle_id").references(() => cyclesTable.id, { onDelete: "set null" }),
    cycleName: text("cycle_name"),
    cycleNumber: real("cycle_number"),
    storageKey: text("storage_key").notNull(),
    fileHash: text("file_hash"),
    fileSize: integer("file_size").notNull().default(0),
    status: bookStatusEnum("status").notNull().default("active"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
    hideFromPopular: boolean("hide_from_popular").notNull().default(false),
    // Подарочная копия: главы и файл берутся из канонической книги, метаданные — свои.
    contentBookId: integer("content_book_id").references((): AnyPgColumn => booksTable.id, { onDelete: "restrict" }),
    // Внешний источник (файл в облаке владельца). Для обычных книг все поля NULL.
    externalConnectionId: integer("external_connection_id").references((): AnyPgColumn => externalStorageConnectionsTable.id, { onDelete: "set null" }),
    externalProvider: externalStorageProviderEnum("external_provider"),
    externalPath: text("external_path"),
    externalEtag: text("external_etag"),
    externalModifiedAt: timestamp("external_modified_at", { withTimezone: true }),
    externalMissing: boolean("external_missing").notNull().default(false),
    // Оперативный кэш контента глав (html_content), выселяемый по LRU.
    contentCacheBytes: integer("content_cache_bytes").notNull().default(0),
    contentAccessedAt: timestamp("content_accessed_at", { withTimezone: true }),
  },
  (t) => [
    index("books_owner_user_id_idx").on(t.ownerUserId),
    index("books_file_hash_idx").on(t.fileHash),
    index("books_owner_uploaded_at_idx").on(t.ownerUserId, t.uploadedAt),
    uniqueIndex("books_owner_content_book_uidx").on(t.ownerUserId, t.contentBookId),
    index("books_content_book_id_idx").on(t.contentBookId),
    uniqueIndex("books_external_source_uidx").on(t.externalConnectionId, t.externalPath),
    index("books_external_provider_idx").on(t.ownerUserId, t.externalProvider),
    index("books_content_accessed_idx").on(t.contentAccessedAt),
  ],
);

export const insertBookSchema = createInsertSchema(booksTable).omit({ id: true, uploadedAt: true, updatedAt: true });
export type InsertBook = z.infer<typeof insertBookSchema>;
export type Book = typeof booksTable.$inferSelect;
