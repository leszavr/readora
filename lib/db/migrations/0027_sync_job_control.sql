-- Migration 0027: управление синхронизацией внешних хранилищ — статусы
-- 'paused' (пауза, возобновляемая) и 'cancelled' (остановлена).
ALTER TYPE "public"."external_sync_job_status" ADD VALUE IF NOT EXISTS 'paused';--> statement-breakpoint
ALTER TYPE "public"."external_sync_job_status" ADD VALUE IF NOT EXISTS 'cancelled';
