CREATE INDEX IF NOT EXISTS "users_email_lower_idx" ON "users" (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "books_owner_user_id_idx" ON "books" ("owner_user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "books_file_hash_idx" ON "books" ("file_hash") WHERE "file_hash" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "books_owner_uploaded_at_idx" ON "books" ("owner_user_id", "uploaded_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_book_id_index_idx" ON "chapters" ("book_id", "index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "book_genres_genre_id_book_id_idx" ON "book_genres" ("genre_id", "book_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cycles_owner_user_id_name_idx" ON "cycles" ("owner_user_id", "name");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "read_events_book_id_created_at_idx" ON "read_events" ("book_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "read_events_user_id_created_at_idx" ON "read_events" ("user_id", "created_at");--> statement-breakpoint
INSERT INTO "genres" ("code", "name", "description", "is_active") VALUES
  ('fiction', 'Художественная литература', 'Общая проза, классика и современная художественная литература.', true),
  ('fantasy', 'Фэнтези', 'Фэнтези и героическое фэнтези.', true),
  ('science_fiction', 'Научная фантастика', 'Научная фантастика, космоопера, киберпанк и близкие направления.', true),
  ('detective', 'Детектив', 'Детективы, криминальные расследования и шпионская проза.', true),
  ('thriller', 'Триллер', 'Триллеры, саспенс и напряжённые сюжетные книги.', true),
  ('romance', 'Романтика', 'Любовные романы и романтическая проза.', true),
  ('historical', 'Историческая проза', 'Исторические романы, военная и историко-приключенческая проза.', true),
  ('adventure', 'Приключения', 'Приключенческая литература, путешествия и авантюрная проза.', true),
  ('horror', 'Ужасы', 'Ужасы, мистика и тёмная фантастика.', true),
  ('humor', 'Юмор', 'Юмористическая проза, сатира и анекдотические сборники.', true),
  ('poetry', 'Поэзия', 'Стихи, поэмы и поэтические сборники.', true),
  ('drama', 'Драма', 'Пьесы, драматургия и театральные тексты.', true),
  ('children', 'Детская литература', 'Книги для детей и подростков.', true),
  ('nonfiction', 'Нон-фикшн', 'Документальная, прикладная и познавательная литература.', true),
  ('biography', 'Биография', 'Биографии, мемуары и воспоминания.', true),
  ('business', 'Бизнес', 'Бизнес, экономика, маркетинг и карьера.', true),
  ('psychology', 'Психология', 'Психология, саморазвитие и поведенческие науки.', true),
  ('science', 'Наука', 'Научно-популярная и академическая литература.', true),
  ('education', 'Образование', 'Учебники, справочники, программирование и техническая документация.', true)
ON CONFLICT ("code") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "is_active" = EXCLUDED."is_active";
