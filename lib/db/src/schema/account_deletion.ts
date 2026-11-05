import { check, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// Журнал жизненного цикла удаления аккаунта. user_id намеренно без FK:
// записи переживают удаление аккаунта и служат обезличенным аудитом
// (только идентификаторы и действия, без email/имён/содержимого).
export const accountDeletionLogTable = pgTable(
  "account_deletion_log",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    action: text("action").notNull(),
    actor: text("actor").notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      "account_deletion_action_check",
      sql`${t.action} in ('scheduled', 'restored', 'purged')`,
    ),
    check(
      "account_deletion_actor_check",
      sql`${t.actor} in ('user', 'admin', 'system')`,
    ),
    index("account_deletion_user_action_idx").on(t.userId, t.action),
    index("account_deletion_created_at_idx").on(t.createdAt),
  ],
);

export type AccountDeletionLogEntry = typeof accountDeletionLogTable.$inferSelect;
