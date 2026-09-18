ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "analytics_opt_in" boolean NOT NULL DEFAULT false;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analytics_events" (
  "event_id" uuid PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "book_id" integer REFERENCES "books"("id") ON DELETE cascade,
  "event_name" text NOT NULL,
  "producer" text NOT NULL CHECK ("producer" IN ('client', 'server')),
  "schema_version" smallint NOT NULL DEFAULT 1,
  "occurred_at" timestamp with time zone NOT NULL,
  "occurred_local_date" date NOT NULL,
  "received_at" timestamp with time zone NOT NULL DEFAULT now(),
  "client_id" uuid,
  "session_id" uuid,
  "platform" text NOT NULL CHECK ("platform" IN ('web')),
  "device_mode" text NOT NULL DEFAULT 'unknown' CHECK ("device_mode" IN ('desktop', 'mobile', 'unknown')),
  "app_version" varchar(64),
  "properties" jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "analytics_events_properties_object" CHECK (jsonb_typeof("properties") = 'object')
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_user_date_idx" ON "analytics_events" ("user_id", "occurred_local_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_name_time_idx" ON "analytics_events" ("event_name", "occurred_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_book_time_idx" ON "analytics_events" ("book_id", "occurred_at" DESC) WHERE "book_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_reading_progress_idx" ON "analytics_events" ("book_id", "user_id", "occurred_at" DESC) WHERE "event_name" = 'reading_progressed';--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analytics_daily_user_activity" (
  "activity_date" date NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "device_mode" text NOT NULL CHECK ("device_mode" IN ('desktop', 'mobile', 'unknown')),
  "app_opens" integer NOT NULL DEFAULT 0,
  "reader_sessions" integer NOT NULL DEFAULT 0,
  "active_reading_ms" bigint NOT NULL DEFAULT 0,
  "books_started" integer NOT NULL DEFAULT 0,
  "books_completed" integer NOT NULL DEFAULT 0,
  "sync_attempts" integer NOT NULL DEFAULT 0,
  "sync_successes" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("activity_date", "user_id", "device_mode")
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analytics_daily_book_activity" (
  "activity_date" date NOT NULL,
  "book_id" integer NOT NULL REFERENCES "books"("id") ON DELETE cascade,
  "readers" integer NOT NULL DEFAULT 0,
  "reader_sessions" integer NOT NULL DEFAULT 0,
  "active_reading_ms" bigint NOT NULL DEFAULT 0,
  "starts" integer NOT NULL DEFAULT 0,
  "completions" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("activity_date", "book_id")
);
