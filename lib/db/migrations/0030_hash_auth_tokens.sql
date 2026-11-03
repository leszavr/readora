-- Migration 0030: токены подтверждения email, сброса и смены пароля
-- хранятся в БД как sha256-хэши исходного значения. Существующие строки
-- конвертируются, поэтому ссылки из уже отправленных писем продолжают
-- работать: проверка хэширует входное значение токена.
UPDATE "email_verification_tokens" SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');--> statement-breakpoint
UPDATE "password_reset_tokens" SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');--> statement-breakpoint
UPDATE "password_change_tokens" SET "token" = encode(sha256(convert_to("token", 'UTF8')), 'hex');
