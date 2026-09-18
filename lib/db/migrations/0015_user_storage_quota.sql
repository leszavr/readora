CREATE INDEX IF NOT EXISTS "book_upload_jobs_owner_status_idx"
ON "book_upload_jobs" ("owner_user_id", "status");
