-- Migration 0024: журнал автоматических действий над аккаунтами без подтверждённого email.
CREATE TABLE IF NOT EXISTS "unverified_account_cleanup_log" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL,
  "action" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "unverified_account_cleanup_action_check" CHECK ("action" in ('reminder_sent', 'account_deleted'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unverified_account_cleanup_user_action_idx" ON "unverified_account_cleanup_log" ("user_id","action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "unverified_account_cleanup_created_at_idx" ON "unverified_account_cleanup_log" ("created_at");
