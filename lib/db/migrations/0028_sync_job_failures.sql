-- Migration 0028: детализация ошибок синхронизации внешних хранилищ —
-- какие файлы упали (путь/имя) и почему (скачивание или обработка).
DO $$ BEGIN
  CREATE TYPE "public"."external_sync_failure_reason" AS ENUM ('download', 'parse');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_sync_job_failures" (
  "id" bigserial PRIMARY KEY,
  "job_id" integer NOT NULL REFERENCES "external_sync_jobs"("id") ON DELETE CASCADE,
  "external_path" text NOT NULL,
  "file_name" text NOT NULL,
  "reason" "external_sync_failure_reason" NOT NULL,
  "error_message" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_sync_job_failures_idx" ON "external_sync_job_failures" ("job_id");
