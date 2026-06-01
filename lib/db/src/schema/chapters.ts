import { index, pgTable, text, serial, integer, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { booksTable } from "./books";

export const parsingStatusEnum = pgEnum("parsing_status", ["pending", "done", "error"]);

export const chaptersTable = pgTable(
  "chapters",
  {
    id: serial("id").primaryKey(),
    bookId: integer("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
    index: integer("index").notNull(),
    title: text("title").notNull(),
    htmlContent: text("html_content").notNull().default(""),
    wordCount: integer("word_count"),
  },
  (t) => [index("chapters_book_id_index_idx").on(t.bookId, t.index)],
);

export const insertChapterSchema = createInsertSchema(chaptersTable).omit({ id: true });
export type InsertChapter = z.infer<typeof insertChapterSchema>;
export type Chapter = typeof chaptersTable.$inferSelect;
