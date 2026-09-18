ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "external_provider" text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "external_id" text;
CREATE UNIQUE INDEX IF NOT EXISTS "users_external_provider_external_id_idx" ON "users" ("external_provider", "external_id");
