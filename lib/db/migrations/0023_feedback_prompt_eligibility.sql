-- Migration 0023: server-side eligibility state for the feedback survey.
CREATE TABLE IF NOT EXISTS "feedback_prompt_states" (
  "user_id" integer PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "visit_count" integer NOT NULL DEFAULT 0,
  "last_visit_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_shown_at" timestamp with time zone,
  "submitted_at" timestamp with time zone
);
