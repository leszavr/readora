-- Migration 0020: Feedback survey responses (exit-intent опрос оценки сайта)
-- Анонимные ответы хранят session_id, авторизованные — user_id (при удалении пользователя обнуляется).

CREATE TABLE IF NOT EXISTS "feedback_responses" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" integer REFERENCES "users"("id") ON DELETE SET NULL,
  "session_id" varchar(64),
  "rating" integer NOT NULL,
  "pain_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "missing_feature" text,
  "wants_contact" boolean DEFAULT false NOT NULL,
  "contact_info" text,
  "page_url" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "feedback_responses_rating_check" CHECK ("rating" >= 1 AND "rating" <= 5)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "feedback_responses_created_at_idx" ON "feedback_responses" USING btree ("created_at");
