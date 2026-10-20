-- Migration 0024: явная цель загрузки исключает временную личную книгу администратора.

DO $$ BEGIN
  CREATE TYPE "book_upload_job_target" AS ENUM ('personal', 'catalog_source');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "book_upload_jobs"
  ADD COLUMN IF NOT EXISTS "target" "book_upload_job_target" NOT NULL DEFAULT 'personal';
