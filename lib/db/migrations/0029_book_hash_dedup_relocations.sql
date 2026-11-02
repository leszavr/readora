-- Migration 0029: дедупликация по fileHash при синхронизации облака.
-- Индекс для поиска книги владельца по хешу, причина ошибки «duplicate»
-- и кандидаты на переезд локальной книги в облако (external_book_relocations).
CREATE INDEX IF NOT EXISTS "books_owner_file_hash_idx" ON "books" ("owner_user_id", "file_hash");--> statement-breakpoint
ALTER TYPE "public"."external_sync_failure_reason" ADD VALUE IF NOT EXISTS 'duplicate';--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."external_relocation_status" AS ENUM ('pending', 'migrated', 'dismissed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_book_relocations" (
  "id" serial PRIMARY KEY NOT NULL,
  "connection_id" integer NOT NULL REFERENCES "external_storage_connections"("id") ON DELETE CASCADE,
  "owner_user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "book_id" integer NOT NULL REFERENCES "books"("id") ON DELETE CASCADE,
  "external_path" text NOT NULL,
  "file_name" text NOT NULL,
  "file_size" integer DEFAULT 0 NOT NULL,
  "etag" text,
  "status" "external_relocation_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "resolved_at" timestamp with time zone,
  CONSTRAINT "external_book_relocations_connection_book_uidx" UNIQUE("connection_id", "book_id")
);
