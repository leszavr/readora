CREATE TABLE IF NOT EXISTS "analytics_rollup_queue" (
  "activity_date" date PRIMARY KEY NOT NULL,
  "queued_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION "enqueue_analytics_rollup"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "analytics_rollup_queue" ("activity_date")
  VALUES (NEW."occurred_local_date")
  ON CONFLICT ("activity_date") DO UPDATE
  SET "updated_at" = now();
  RETURN NEW;
END;
$$;--> statement-breakpoint

DROP TRIGGER IF EXISTS "analytics_events_enqueue_rollup" ON "analytics_events";--> statement-breakpoint
CREATE TRIGGER "analytics_events_enqueue_rollup"
AFTER INSERT ON "analytics_events"
FOR EACH ROW
EXECUTE FUNCTION "enqueue_analytics_rollup"();--> statement-breakpoint

INSERT INTO "analytics_rollup_queue" ("activity_date")
SELECT DISTINCT "occurred_local_date"
FROM "analytics_events"
ON CONFLICT ("activity_date") DO NOTHING;
