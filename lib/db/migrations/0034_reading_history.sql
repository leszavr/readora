-- Migration 0034: история прочитанного.
-- Журнал завершений книги: одна запись на каждое завершение. Запись создаётся
-- триггером при переходе статуса чтения в finished и не зависит от текущего
-- статуса: «Читать снова» и удаление книги её не удаляют. При удалении книги
-- book_id обнуляется, а снимок метаданных и обложки остаётся.
CREATE TABLE IF NOT EXISTS "reading_history" (
    "id" serial PRIMARY KEY,
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "book_id" integer REFERENCES "books"("id") ON DELETE SET NULL,
    "title" text NOT NULL,
    "author" text,
    "cover_path" text,
    "cycle_name" text,
    "genre_name" text,
    "completed_at" timestamp with time zone NOT NULL DEFAULT now(),
    "comment" varchar(255),
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reading_history_user_completed_at_idx" ON "reading_history" ("user_id", "completed_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reading_history_book_id_idx" ON "reading_history" ("book_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reading_history_cover_path_idx" ON "reading_history" ("cover_path");--> statement-breakpoint

-- Снимок берётся на момент завершения. «Первым» жанром считается жанр с
-- меньшим id — так же, как в списке истории.
CREATE OR REPLACE FUNCTION "record_reading_history"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "reading_history" ("user_id", "book_id", "title", "author", "cover_path", "cycle_name", "genre_name", "completed_at")
  SELECT
    NEW."user_id",
    NEW."book_id",
    b."title",
    b."author",
    b."cover_path",
    COALESCE(c."name", b."cycle_name"),
    (SELECT g."name" FROM "book_genres" bg JOIN "genres" g ON g."id" = bg."genre_id" WHERE bg."book_id" = b."id" ORDER BY bg."genre_id" LIMIT 1),
    COALESCE(NEW."completed_at", now())
  FROM "books" b
  LEFT JOIN "cycles" c ON c."id" = b."cycle_id"
  WHERE b."id" = NEW."book_id";
  RETURN NULL;
END;
$$;--> statement-breakpoint

-- Отдельные триггеры для INSERT и UPDATE: условие триггера на INSERT не может
-- ссылаться на OLD. WHEN отсекает повторные сохранения уже прочитанной книги.
DROP TRIGGER IF EXISTS "reading_progress_insert_history" ON "reading_progress";--> statement-breakpoint
CREATE TRIGGER "reading_progress_insert_history"
AFTER INSERT ON "reading_progress"
FOR EACH ROW
WHEN (NEW."reading_status" = 'finished')
EXECUTE FUNCTION "record_reading_history"();--> statement-breakpoint

DROP TRIGGER IF EXISTS "reading_progress_update_history" ON "reading_progress";--> statement-breakpoint
CREATE TRIGGER "reading_progress_update_history"
AFTER UPDATE OF "reading_status" ON "reading_progress"
FOR EACH ROW
WHEN (NEW."reading_status" = 'finished' AND OLD."reading_status" IS DISTINCT FROM 'finished')
EXECUTE FUNCTION "record_reading_history"();--> statement-breakpoint

-- Уже прочитанные книги переносятся в историю одной записью на книгу.
INSERT INTO "reading_history" ("user_id", "book_id", "title", "author", "cover_path", "cycle_name", "genre_name", "completed_at", "created_at")
SELECT
  rp."user_id",
  rp."book_id",
  b."title",
  b."author",
  b."cover_path",
  COALESCE(c."name", b."cycle_name"),
  (SELECT g."name" FROM "book_genres" bg JOIN "genres" g ON g."id" = bg."genre_id" WHERE bg."book_id" = b."id" ORDER BY bg."genre_id" LIMIT 1),
  COALESCE(rp."completed_at", rp."last_read_at", now()),
  COALESCE(rp."completed_at", rp."last_read_at", now())
FROM "reading_progress" rp
JOIN "books" b ON b."id" = rp."book_id"
LEFT JOIN "cycles" c ON c."id" = b."cycle_id"
WHERE rp."reading_status" = 'finished';
