import { pgTable, text, serial, timestamp, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const userRoleEnum = pgEnum("user_role", ["user", "moderator", "admin"]);
export const userStatusEnum = pgEnum("user_status", ["active", "blocked"]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  username: text("username").notNull(),
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").notNull().default("user"),
  status: userStatusEnum("status").notNull().default("active"),
  avatar: text("avatar"),
  emailVerified: boolean("email_verified").notNull().default(false),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  analyticsOptIn: boolean("analytics_opt_in").notNull().default(true),
  referralSource: text("referral_source"),
  externalProvider: text("external_provider"),
  externalId: text("external_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
