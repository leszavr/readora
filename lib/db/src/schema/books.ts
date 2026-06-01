import { index, pgTable, text, serial, integer, timestamp, pgEnum, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { cyclesTable } from "./cycles";

export const bookFormatEnum = pgEnum("book_format", ["fb2", "epub"]);
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
  },
  (t) => [
    index("books_owner_user_id_idx").on(t.ownerUserId),
    index("books_file_hash_idx").on(t.fileHash),
    index("books_owner_uploaded_at_idx").on(t.ownerUserId, t.uploadedAt),
  ],
);

export const insertBookSchema = createInsertSchema(booksTable).omit({ id: true, uploadedAt: true, updatedAt: true });
export type InsertBook = z.infer<typeof insertBookSchema>;
export type Book = typeof booksTable.$inferSelect;
