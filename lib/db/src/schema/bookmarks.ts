import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { booksTable } from "./books";
import { chaptersTable } from "./chapters";

export const bookmarksTable = pgTable("bookmarks", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  bookId: integer("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").notNull().references(() => chaptersTable.id, { onDelete: "cascade" }),
  positionRaw: text("position_raw").notNull(),
  label: text("label"),
  selectedText: text("selected_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookmarkSchema = createInsertSchema(bookmarksTable, {
  label: z.string().trim().min(1).max(200).optional().nullable(),
  selectedText: z.string().trim().max(100).optional().nullable(),
  positionRaw: z.string().trim().min(1).max(8000),
});
export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarksTable.$inferSelect;
