-- Migration 0018: Reader Notes (адаптация VoxLibris)
-- Заметки с выделенным фрагментом текста и комментариями

CREATE TABLE IF NOT EXISTS "notes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "book_id" integer NOT NULL REFERENCES "books"("id") ON DELETE CASCADE,
  "chapter_id" integer NOT NULL REFERENCES "chapters"("id") ON DELETE CASCADE,
  "position_raw" text NOT NULL,
  "highlighted_text" text,
  "note_text" text NOT NULL,
  "color" varchar(20) NOT NULL DEFAULT 'yellow',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "notes_user_book_idx" ON "notes" ("user_id", "book_id");
CREATE INDEX IF NOT EXISTS "notes_book_chapter_idx" ON "notes" ("book_id", "chapter_id");
CREATE INDEX IF NOT EXISTS "notes_updated_at_idx" ON "notes" ("updated_at");

-- Добавляем колонку selected_text к существующей таблице bookmarks
ALTER TABLE "bookmarks" ADD COLUMN IF NOT EXISTS "selected_text" text;
