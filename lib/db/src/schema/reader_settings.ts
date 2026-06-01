import { pgTable, integer, real, text, timestamp, pgEnum, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const readerThemeEnum = pgEnum("reader_theme", ["light", "dark", "sepia"]);
export const readerDeviceModeEnum = pgEnum("reader_device_mode", ["desktop", "mobile"]);

export const readerSettingsTable = pgTable("reader_settings", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  deviceMode: readerDeviceModeEnum("device_mode").notNull().default("desktop"),
  fontSize: integer("font_size").notNull().default(18),
  fontFamily: text("font_family").notNull().default("Georgia"),
  lineHeight: real("line_height").notNull().default(1.7),
  theme: readerThemeEnum("theme").notNull().default("light"),
  contentWidth: integer("content_width").notNull().default(80),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [primaryKey({ columns: [t.userId, t.deviceMode] })]);

export const insertReaderSettingsSchema = createInsertSchema(readerSettingsTable).omit({ updatedAt: true });
export type InsertReaderSettings = z.infer<typeof insertReaderSettingsSchema>;
export type ReaderSettings = typeof readerSettingsTable.$inferSelect;
