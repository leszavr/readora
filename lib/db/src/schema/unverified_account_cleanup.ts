import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Журнал автоматических действий над аккаунтами без подтверждённого email.
// user_id намеренно без FK: записи переживают удаление аккаунта и нужны для аналитики.
export const unverifiedAccountCleanupLogTable = pgTable(
  "unverified_account_cleanup_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    action: text("action").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "unverified_account_cleanup_action_check",
      sql`${t.action} in ('reminder_sent', 'account_deleted')`,
    ),
    index("unverified_account_cleanup_user_action_idx").on(t.userId, t.action),
    index("unverified_account_cleanup_created_at_idx").on(t.createdAt),
  ],
);

export type UnverifiedAccountCleanupLogEntry = typeof unverifiedAccountCleanupLogTable.$inferSelect;
