import { pgTable, integer, real, timestamp, pgEnum, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { booksTable } from "./books";

export const readingStatusEnum = pgEnum("reading_status", ["not_started", "reading", "finished"]);

export const readingProgressTable = pgTable("reading_progress", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  bookId: integer("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
  currentChapterId: integer("current_chapter_id"),
  currentPosition: real("current_position"),
  progressPercent: real("progress_percent"),
  readingStatus: readingStatusEnum("reading_status").notNull().default("not_started"),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [primaryKey({ columns: [t.userId, t.bookId] })]);

export const insertProgressSchema = createInsertSchema(readingProgressTable);
export type InsertProgress = z.infer<typeof insertProgressSchema>;
export type ReadingProgress = typeof readingProgressTable.$inferSelect;
