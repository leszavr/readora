import { pgTable, text, serial, timestamp, integer, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const rememberTokensTable = pgTable(
  "remember_tokens",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    deviceInfo: text("device_info"), // User-Agent
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("idx_remember_tokens_user_id").on(table.userId),
    index("idx_remember_tokens_expires_at").on(table.expiresAt),
    index("idx_remember_tokens_token_hash").on(table.tokenHash),
  ],
);

export type RememberToken = typeof rememberTokensTable.$inferSelect;
export type InsertRememberToken = typeof rememberTokensTable.$inferInsert;
