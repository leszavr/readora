ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_source" text;--> statement-breakpoint

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_referral_source_check";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_source_check"
CHECK ("referral_source" IS NULL OR "referral_source" IN (
  'direct', 'telegram', 'habr', 'productradar', 'show_hn', 'reddit', 'vk', 'seo', 'other'
));--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "users_created_at_idx" ON "users" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_referral_source_created_at_idx" ON "users" ("referral_source", "created_at");
