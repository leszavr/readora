-- Migration 0019: Подарочные издания («Мировое достояние»)
-- Копия книги у пользователя ссылается на каноническую книгу, из которой берутся главы и файл.

ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "content_book_id" integer REFERENCES "books"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "books_owner_content_book_uidx" ON "books" USING btree ("owner_user_id", "content_book_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "books_content_book_id_idx" ON "books" USING btree ("content_book_id");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gift_editions" (
  "id" serial PRIMARY KEY NOT NULL,
  "book_id" integer NOT NULL UNIQUE REFERENCES "books"("id") ON DELETE CASCADE,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_published" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gift_editions_published_sort_order_idx" ON "gift_editions" USING btree ("is_published", "sort_order");
