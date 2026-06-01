import { pgTable, text, serial, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const genresTable = pgTable("genres", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
});

export const insertGenreSchema = createInsertSchema(genresTable).omit({ id: true });
export type InsertGenre = z.infer<typeof insertGenreSchema>;
export type Genre = typeof genresTable.$inferSelect;
