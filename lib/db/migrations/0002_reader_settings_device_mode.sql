CREATE TYPE "public"."reader_device_mode" AS ENUM('desktop', 'mobile');--> statement-breakpoint
ALTER TABLE "reader_settings" DROP CONSTRAINT "reader_settings_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "reader_settings" DROP CONSTRAINT "reader_settings_pkey";
--> statement-breakpoint
ALTER TABLE "reader_settings" ADD COLUMN "device_mode" "reader_device_mode" DEFAULT 'desktop' NOT NULL;
--> statement-breakpoint
ALTER TABLE "reader_settings" ALTER COLUMN "font_size" SET DEFAULT 18;
--> statement-breakpoint
ALTER TABLE "reader_settings" ALTER COLUMN "line_height" SET DEFAULT 1.7;
--> statement-breakpoint
ALTER TABLE "reader_settings" ALTER COLUMN "content_width" SET DEFAULT 80;
--> statement-breakpoint
UPDATE "reader_settings" SET "content_width" = 80 WHERE "content_width" > 100;
--> statement-breakpoint
ALTER TABLE "reader_settings" ADD CONSTRAINT "reader_settings_user_id_device_mode_pk" PRIMARY KEY("user_id","device_mode");
--> statement-breakpoint
ALTER TABLE "reader_settings" ADD CONSTRAINT "reader_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
