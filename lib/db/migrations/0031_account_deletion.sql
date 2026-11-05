-- Migration 0031: отложенное удаление аккаунта (модель GitHub).
-- Помечается только датой: scheduled_deletion_at IS NULL = аккаунт активен.
-- Status/enum не трогаем — «на удалении» вычисляется по колонке, а вход
-- блокируется на уровне авторизации. Фактическую очистку выполняет
-- планировщик account-deletion (транзакция БД, затем файлы).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "scheduled_deletion_at" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "account_deletion_log" (
    "id" serial PRIMARY KEY,
    "user_id" integer NOT NULL,
    "action" text NOT NULL,
    "actor" text NOT NULL,
    "scheduled_for" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_deletion_action_check'
  ) THEN
    ALTER TABLE "account_deletion_log" ADD CONSTRAINT "account_deletion_action_check"
      CHECK ("action" in ('scheduled', 'restored', 'purged')) NOT VALID;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_deletion_actor_check'
  ) THEN
    ALTER TABLE "account_deletion_log" ADD CONSTRAINT "account_deletion_actor_check"
      CHECK ("actor" in ('user', 'admin', 'system')) NOT VALID;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_deletion_user_action_idx" ON "account_deletion_log" ("user_id", "action");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_deletion_created_at_idx" ON "account_deletion_log" ("created_at");
