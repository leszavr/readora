ALTER TABLE "analytics_events" ADD COLUMN IF NOT EXISTS "event_day" date;--> statement-breakpoint
UPDATE "analytics_events"
SET "event_day" = ("occurred_at" AT TIME ZONE 'UTC')::date
WHERE "event_day" IS NULL;--> statement-breakpoint
ALTER TABLE "analytics_events" ALTER COLUMN "event_day" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "analytics_daily_user_activity" ADD COLUMN IF NOT EXISTS "reader_session_starts" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "analytics_daily_user_activity" ADD COLUMN IF NOT EXISTS "reader_session_ends" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "analytics_daily_book_activity" ADD COLUMN IF NOT EXISTS "reader_session_starts" integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE "analytics_daily_book_activity" ADD COLUMN IF NOT EXISTS "reader_session_ends" integer NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE "analytics_events" DROP CONSTRAINT IF EXISTS "analytics_events_book_id_fkey";--> statement-breakpoint
ALTER TABLE "analytics_daily_book_activity" DROP CONSTRAINT IF EXISTS "analytics_daily_book_activity_book_id_fkey";--> statement-breakpoint

DROP INDEX IF EXISTS "analytics_events_user_date_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_user_date_idx" ON "analytics_events" ("user_id", "event_day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_event_day_idx" ON "analytics_events" ("event_day");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_events_received_at_idx" ON "analytics_events" ("received_at");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "analytics_reader_sessions" (
  "session_id" uuid PRIMARY KEY NOT NULL,
  "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "book_id" integer NOT NULL,
  "device_mode" text NOT NULL CHECK ("device_mode" IN ('desktop', 'mobile', 'unknown')),
  "started_at" timestamp with time zone NOT NULL,
  "last_seen_at" timestamp with time zone NOT NULL,
  "ended_at" timestamp with time zone,
  "active_reading_ms" bigint NOT NULL DEFAULT 0
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_reader_sessions_user_started_idx" ON "analytics_reader_sessions" ("user_id", "started_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analytics_reader_sessions_open_idx" ON "analytics_reader_sessions" ("last_seen_at") WHERE "ended_at" IS NULL;--> statement-breakpoint

CREATE OR REPLACE FUNCTION "enqueue_analytics_rollup"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "analytics_rollup_queue" ("activity_date")
  VALUES (NEW."event_day")
  ON CONFLICT ("activity_date") DO UPDATE
  SET "updated_at" = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

INSERT INTO "analytics_rollup_queue" ("activity_date")
SELECT DISTINCT "occurred_local_date" FROM "analytics_events"
UNION
SELECT DISTINCT "event_day" FROM "analytics_events"
ON CONFLICT ("activity_date") DO UPDATE
SET "updated_at" = now();
