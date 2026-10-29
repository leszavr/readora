-- Migration 0025: расширение book_format новыми форматами книг (MOBI/AZW3, CBZ, TXT, MD, HTML).
ALTER TYPE "book_format" ADD VALUE IF NOT EXISTS 'mobi';--> statement-breakpoint
ALTER TYPE "book_format" ADD VALUE IF NOT EXISTS 'cbz';--> statement-breakpoint
ALTER TYPE "book_format" ADD VALUE IF NOT EXISTS 'txt';--> statement-breakpoint
ALTER TYPE "book_format" ADD VALUE IF NOT EXISTS 'md';--> statement-breakpoint
ALTER TYPE "book_format" ADD VALUE IF NOT EXISTS 'html';
