-- Migration 0023: независимый каталог public-domain изданий.
-- Канонический контент больше не принадлежит личной библиотеке администратора.

DO $$ BEGIN
  CREATE TYPE "book_scope" AS ENUM ('personal', 'catalog_source');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

DO $$ BEGIN
  CREATE TYPE "catalog_edition_status" AS ENUM ('draft', 'published', 'hidden', 'withdrawn');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint

ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "scope" "book_scope" NOT NULL DEFAULT 'personal';--> statement-breakpoint
ALTER TABLE "books" ALTER COLUMN "owner_user_id" DROP NOT NULL;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "catalog_editions" (
  "id" serial PRIMARY KEY NOT NULL,
  "source_book_id" integer NOT NULL UNIQUE REFERENCES "books"("id") ON DELETE RESTRICT,
  "status" "catalog_edition_status" NOT NULL DEFAULT 'draft',
  "created_by_user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "primary_genre_id" integer REFERENCES "genres"("id") ON DELETE SET NULL,
  "is_landing_featured" boolean NOT NULL DEFAULT false,
  "landing_featured_sort_order" integer NOT NULL DEFAULT 0,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "catalog_editions_status_published_at_idx" ON "catalog_editions" USING btree ("status", "published_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_editions_featured_sort_order_idx" ON "catalog_editions" USING btree ("is_landing_featured", "landing_featured_sort_order");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "catalog_editions_primary_genre_id_idx" ON "catalog_editions" USING btree ("primary_genre_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "catalog_gift_offers" (
  "id" serial PRIMARY KEY NOT NULL,
  "catalog_edition_id" integer NOT NULL UNIQUE REFERENCES "catalog_editions"("id") ON DELETE CASCADE,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_published" boolean NOT NULL DEFAULT true,
  "available_from" timestamp with time zone,
  "available_until" timestamp with time zone,
  "auto_grant_on_signup" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "catalog_gift_offers_active_sort_order_idx" ON "catalog_gift_offers" USING btree ("is_published", "sort_order");--> statement-breakpoint

-- Переносим текущие подарочные издания. Их пользовательские копии сохраняют content_book_id.
INSERT INTO "catalog_editions" ("source_book_id", "status", "created_by_user_id", "primary_genre_id", "published_at")
SELECT
  ge."book_id",
  CASE WHEN ge."is_published" THEN 'published'::"catalog_edition_status" ELSE 'hidden'::"catalog_edition_status" END,
  b."owner_user_id",
  (
    SELECT bg."genre_id"
    FROM "book_genres" bg
    WHERE bg."book_id" = ge."book_id"
    ORDER BY bg."genre_id"
    LIMIT 1
  ),
  CASE WHEN ge."is_published" THEN ge."created_at" ELSE NULL END
FROM "gift_editions" ge
JOIN "books" b ON b."id" = ge."book_id"
ON CONFLICT ("source_book_id") DO NOTHING;--> statement-breakpoint

INSERT INTO "catalog_gift_offers" ("catalog_edition_id", "sort_order", "is_published", "auto_grant_on_signup", "created_at", "updated_at")
SELECT ce."id", ge."sort_order", ge."is_published", true, ge."created_at", ge."updated_at"
FROM "gift_editions" ge
JOIN "catalog_editions" ce ON ce."source_book_id" = ge."book_id"
ON CONFLICT ("catalog_edition_id") DO NOTHING;--> statement-breakpoint

UPDATE "books" b
SET "scope" = 'catalog_source', "owner_user_id" = NULL, "hide_from_popular" = true
FROM "catalog_editions" ce
WHERE ce."source_book_id" = b."id";--> statement-breakpoint

ALTER TABLE "books" DROP CONSTRAINT IF EXISTS "books_scope_owner_check";--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_scope_owner_check"
CHECK (
  ("scope" = 'personal' AND "owner_user_id" IS NOT NULL)
  OR ("scope" = 'catalog_source' AND "owner_user_id" IS NULL AND "content_book_id" IS NULL)
);--> statement-breakpoint
