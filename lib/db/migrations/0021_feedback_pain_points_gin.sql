-- Migration 0021: GIN-индекс по pain_points для фильтра jsonb containment (@>)
CREATE INDEX IF NOT EXISTS "feedback_responses_pain_points_idx" ON "feedback_responses" USING gin ("pain_points");
