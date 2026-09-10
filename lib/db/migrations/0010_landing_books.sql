CREATE TABLE IF NOT EXISTS "landing_books" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "author" text,
  "description" text,
  "cover_path" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "is_published" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "landing_books_published_sort_order_idx" ON "landing_books" USING btree ("is_published", "sort_order");
