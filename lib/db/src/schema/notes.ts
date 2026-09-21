import { integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { booksTable } from "./books";
import { chaptersTable } from "./chapters";

export const notesTable = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  bookId: integer("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
  chapterId: integer("chapter_id").notNull().references(() => chaptersTable.id, { onDelete: "cascade" }),
  positionRaw: text("position_raw").notNull(),
  highlightedText: text("highlighted_text"),
  noteText: text("note_text").notNull(),
  color: varchar("color", { length: 20 }).notNull().default("yellow"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertNoteSchema = createInsertSchema(notesTable, {
  highlightedText: z.string().trim().max(100).optional().nullable(),
  noteText: z.string().trim().min(1).max(2000),
  positionRaw: z.string().trim().min(1).max(8000),
  color: z.enum(["yellow", "green", "blue", "pink", "purple"]).default("yellow"),
});

export const updateNoteSchema = z.object({
  noteText: z.string().trim().min(1).max(2000).optional(),
  color: z.enum(["yellow", "green", "blue", "pink", "purple"]).optional(),
});

export type InsertNote = z.infer<typeof insertNoteSchema>;
export type UpdateNote = z.infer<typeof updateNoteSchema>;
export type Note = typeof notesTable.$inferSelect;
