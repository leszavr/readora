CREATE TYPE "public"."book_upload_job_status" AS ENUM('queued', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."book_upload_job_stage" AS ENUM('queued', 'validating', 'parsing', 'saving', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "book_upload_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_user_id" integer NOT NULL,
	"book_id" integer,
	"original_filename" text NOT NULL,
	"file_size" integer DEFAULT 0 NOT NULL,
	"format" text NOT NULL,
	"temp_storage_key" text NOT NULL,
	"status" "book_upload_job_status" DEFAULT 'queued' NOT NULL,
	"stage" "book_upload_job_stage" DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0 NOT NULL,
	"error_message" text,
	"cycle_id" integer,
	"cycle_name" text,
	"cycle_number" real,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "book_upload_jobs" ADD CONSTRAINT "book_upload_jobs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "book_upload_jobs" ADD CONSTRAINT "book_upload_jobs_book_id_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."books"("id") ON DELETE set null ON UPDATE no action;
