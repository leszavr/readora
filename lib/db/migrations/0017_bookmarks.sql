CREATE TABLE IF NOT EXISTS "bookmarks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "book_id" integer NOT NULL REFERENCES "books"("id") ON DELETE CASCADE,
  "chapter_id" integer NOT NULL REFERENCES "chapters"("id") ON DELETE CASCADE,
  "position_raw" text NOT NULL,
  "label" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "bookmarks_user_book_idx" ON "bookmarks" ("user_id", "book_id");
CREATE INDEX IF NOT EXISTS "bookmarks_book_chapter_idx" ON "bookmarks" ("book_id", "chapter_id");
CREATE INDEX IF NOT EXISTS "bookmarks_created_at_idx" ON "bookmarks" ("created_at");
