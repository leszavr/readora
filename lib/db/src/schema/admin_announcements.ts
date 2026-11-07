import { check, index, integer, pgTable, primaryKey, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./users";

export const ANNOUNCEMENT_KINDS = ["announcement", "release"] as const;
export const ANNOUNCEMENT_SEVERITIES = ["info", "warning"] as const;
export const ANNOUNCEMENT_COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;

// Оповещения пользователям от администратора. kind=release — записи Changelog
// о новых версиях платформы; archivedAt скрывает запись из выдачи пользователям.
export const adminAnnouncementsTable = pgTable(
  "admin_announcements",
  {
    id: serial("id").primaryKey(),
    kind: varchar("kind", { length: 20 }).notNull().default("announcement"),
    severity: varchar("severity", { length: 20 }).notNull().default("info"),
    color: varchar("color", { length: 20 }).notNull().default("blue"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("admin_announcements_kind_check", sql`${t.kind} in ('announcement', 'release')`),
    check("admin_announcements_severity_check", sql`${t.severity} in ('info', 'warning')`),
    check("admin_announcements_color_check", sql`${t.color} in ('yellow', 'green', 'blue', 'pink', 'purple')`),
    index("admin_announcements_published_at_idx").on(t.publishedAt),
  ],
);

// Per-user отметки о прочтении; составной PK защищает от дублей.
export const userAnnouncementReadsTable = pgTable(
  "user_announcement_reads",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    announcementId: integer("announcement_id")
      .notNull()
      .references(() => adminAnnouncementsTable.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.announcementId] }),
    index("user_announcement_reads_user_idx").on(t.userId),
  ],
);

export type AdminAnnouncement = typeof adminAnnouncementsTable.$inferSelect;
export type UserAnnouncementRead = typeof userAnnouncementReadsTable.$inferSelect;
