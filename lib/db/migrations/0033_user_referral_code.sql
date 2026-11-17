-- Migration 0033: рекомендации после 5-звёздочного отзыва.
-- referral_code — случайный код пользователя для персональной ссылки /?ref=<code>.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referral_code" varchar(16);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "users_referral_code_key" ON "users" ("referral_code") WHERE "referral_code" IS NOT NULL;--> statement-breakpoint
-- Новый источник регистрации: переход по персональной рекомендации.
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_referral_source_check";--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_referral_source_check'
  ) THEN
    ALTER TABLE "users" ADD CONSTRAINT "users_referral_source_check"
      CHECK ("referral_source" IS NULL OR "referral_source" IN (
        'direct', 'telegram', 'habr', 'productradar', 'show_hn', 'reddit', 'vk', 'seo', 'other', 'referral'
      )) NOT VALID;
  END IF;
END
$$;
