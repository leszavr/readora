ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "hide_from_popular" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "book_upload_jobs" ADD COLUMN IF NOT EXISTS "hide_from_popular" boolean NOT NULL DEFAULT false;
