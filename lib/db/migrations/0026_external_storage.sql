-- Migration 0026: внешние хранилища книг (Яндекс.Диск, Облако Mail.ru):
-- подключения с шифрованными кредами, джобы синхронизации, внешний источник
-- и оперативный кэш контента в books.
DO $$ BEGIN
  CREATE TYPE "public"."external_storage_provider" AS ENUM('yandex_disk', 'mail_ru_cloud');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."external_connection_status" AS ENUM('active', 'auth_error', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."external_sync_job_status" AS ENUM('queued', 'processing', 'completed', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_storage_connections" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"provider" "external_storage_provider" NOT NULL,
	"credentials_encrypted" text NOT NULL,
	"root_folder" text DEFAULT '/' NOT NULL,
	"status" "external_connection_status" DEFAULT 'active' NOT NULL,
	"last_error" text,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "external_sync_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"connection_id" integer NOT NULL,
	"owner_user_id" integer NOT NULL,
	"status" "external_sync_job_status" DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"files_found" integer DEFAULT 0 NOT NULL,
	"files_imported" integer DEFAULT 0 NOT NULL,
	"files_updated" integer DEFAULT 0 NOT NULL,
	"files_missing" integer DEFAULT 0 NOT NULL,
	"files_failed" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "external_connection_id" integer;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "external_provider" "external_storage_provider";--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "external_path" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "external_etag" text;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "external_modified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "external_missing" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "content_cache_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN IF NOT EXISTS "content_accessed_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "external_storage_connections" ADD CONSTRAINT "external_storage_connections_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "external_sync_jobs" ADD CONSTRAINT "external_sync_jobs_connection_id_external_storage_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."external_storage_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "external_sync_jobs" ADD CONSTRAINT "external_sync_jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "books" ADD CONSTRAINT "books_external_connection_id_external_storage_connections_id_fk" FOREIGN KEY ("external_connection_id") REFERENCES "public"."external_storage_connections"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_storage_connections_owner_idx" ON "external_storage_connections" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "external_storage_connections_owner_provider_uidx" ON "external_storage_connections" USING btree ("owner_user_id","provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_sync_jobs_connection_idx" ON "external_sync_jobs" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_sync_jobs_owner_created_idx" ON "external_sync_jobs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "books_external_source_uidx" ON "books" USING btree ("external_connection_id","external_path");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "books_external_provider_idx" ON "books" USING btree ("owner_user_id","external_provider");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "books_content_accessed_idx" ON "books" USING btree ("content_accessed_at");
