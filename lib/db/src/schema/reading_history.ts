import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { usersTable } from "./users";
import { booksTable } from "./books";

// Записи создаёт триггер на reading_progress (миграция 0034) при переходе
// статуса чтения в finished — по одной на каждое завершение.
export const READING_HISTORY_COMMENT_MAX_LENGTH = 255;

export const readingHistoryTable = pgTable(
  "reading_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    bookId: integer("book_id").references(() => booksTable.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    author: text("author"),
    coverPath: text("cover_path"),
    cycleName: text("cycle_name"),
    genreName: text("genre_name"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
    comment: varchar("comment", { length: READING_HISTORY_COMMENT_MAX_LENGTH }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reading_history_user_completed_at_idx").on(t.userId, t.completedAt),
    index("reading_history_book_id_idx").on(t.bookId),
    index("reading_history_cover_path_idx").on(t.coverPath),
  ],
);

export type ReadingHistoryEntry = typeof readingHistoryTable.$inferSelect;
