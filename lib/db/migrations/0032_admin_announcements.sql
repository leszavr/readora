-- Migration 0032: админ-оповещения пользователям и Changelog (kind=release).
-- archivedAt IS NULL = активно и показывается пользователям.
-- Одноразовый сид: история пользовательских обновлений платформы (docs/changelog.html)
-- и запись о текущем релизе. Будущие записи добавляются через админку, а не миграциями.
CREATE TABLE IF NOT EXISTS "admin_announcements" (
    "id" serial PRIMARY KEY,
    "kind" varchar(20) NOT NULL DEFAULT 'announcement',
    "severity" varchar(20) NOT NULL DEFAULT 'info',
    "color" varchar(20) NOT NULL DEFAULT 'blue',
    "title" text NOT NULL,
    "body" text NOT NULL,
    "published_at" timestamp with time zone NOT NULL DEFAULT now(),
    "archived_at" timestamp with time zone,
    "created_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_announcements_kind_check'
  ) THEN
    ALTER TABLE "admin_announcements" ADD CONSTRAINT "admin_announcements_kind_check"
      CHECK ("kind" in ('announcement', 'release')) NOT VALID;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_announcements_severity_check'
  ) THEN
    ALTER TABLE "admin_announcements" ADD CONSTRAINT "admin_announcements_severity_check"
      CHECK ("severity" in ('info', 'warning')) NOT VALID;
  END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'admin_announcements_color_check'
  ) THEN
    ALTER TABLE "admin_announcements" ADD CONSTRAINT "admin_announcements_color_check"
      CHECK ("color" in ('yellow', 'green', 'blue', 'pink', 'purple')) NOT VALID;
  END IF;
END
$$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "admin_announcements_published_at_idx" ON "admin_announcements" ("published_at");--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_announcement_reads" (
    "user_id" integer NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
    "announcement_id" integer NOT NULL REFERENCES "admin_announcements"("id") ON DELETE CASCADE,
    "read_at" timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT "user_announcement_reads_user_id_announcement_id_pk" PRIMARY KEY ("user_id", "announcement_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_announcement_reads_user_idx" ON "user_announcement_reads" ("user_id");--> statement-breakpoint
INSERT INTO "admin_announcements" ("id", "kind", "severity", "color", "title", "body", "published_at") VALUES
  (1, 'release', 'info', 'purple', 'Запуск платформы', E'• Личная библиотека с загрузкой книг FB2 и EPUB (до 50 МБ) — метаданные, обложка и оглавление извлекаются автоматически\n• Ридер в браузере: шрифт, размер, темы, ширина колонки, автосохранение прогресса чтения\n• Фильтры по жанру и статусу чтения, полнотекстовый поиск по библиотеке\n• Циклы и серии с порядковыми номерами\n• Регистрация и вход по email: подтверждение почты, сброс пароля\n• Установка сайта как приложения (PWA)\n• Смена пароля с подтверждением по email; показ/скрытие пароля при входе; точная синхронизация позиции чтения между устройствами', '2026-06-02T12:00:00Z'),
  (2, 'release', 'info', 'blue', 'Навигация и установка', E'• Умная навигация по главам: запоминание позиции прокрутки, листание стрелками, кнопки «предыдущая/следующая»\n• Улучшение установки приложения и превью-ссылки для соцсетей (Open Graph)', '2026-06-03T12:00:00Z'),
  (3, 'release', 'info', 'blue', 'Стабильность', E'• Корректное отображение старых FB2-книг в кодировке Windows-1251\n• Понятный экран технических работ для посетителей на время обслуживания', '2026-06-04T12:00:00Z'),
  (4, 'release', 'info', 'blue', 'Настройки чтения', E'• Настройки ридера сохраняются на устройстве и синхронизируются с сервером\n• «Семантическая» позиция чтения — точное сравнение прогресса между устройствами', '2026-06-07T12:00:00Z'),
  (5, 'release', 'info', 'blue', 'Правовая база и связь', E'• Правовые документы в футере: правила пользования, политика конфиденциальности, информация для правообладателей\n• Форма обратной связи — писать в поддержку можно прямо с сайта', '2026-06-22T12:00:00Z'),
  (6, 'release', 'info', 'blue', 'Книжная полка', E'• Отдельная полка прочитанных книг\n• Циклы на полке показываются «стопками» обложек; выравнивание карточек книг\n• Аккуратная страница «не найдено» (404)', '2026-07-12T12:00:00Z'),
  (7, 'release', 'info', 'blue', 'Удобство и скорость', E'• «Запомнить меня» — автоматический вход при возвращении\n• Массовое удаление книг\n• Ускорение загрузки интерфейса библиотеки', '2026-08-04T12:00:00Z'),
  (8, 'release', 'info', 'blue', 'Публичный сайт', E'• Публичный лендинг с подборкой популярных книг\n• Страница «О проекте» и SEO-разметка для поисковиков\n• Первый самостоятельный сценарий удаления аккаунта', '2026-08-08T12:00:00Z'),
  (9, 'release', 'info', 'blue', 'Лендинг и FB2', E'• Кураторская подборка книг на главной странице\n• Корректное разбиение FB2-книг со «смешанным» оглавлением', '2026-09-10T12:00:00Z'),
  (10, 'release', 'info', 'blue', 'Доверие и открытость', E'• Переписанная политика конфиденциальности и обязательное согласие при регистрации\n• Честное уведомление, если регистрация временно отключена\n• FAQ о самостоятельном развёртывании на «О проекте»', '2026-09-16T12:00:00Z'),
  (11, 'release', 'info', 'purple', 'Вход через соцсети', E'• Вход через Яндекс ID\n• Вход через VK ID — кнопки VK, Одноклассники и Почта\n• Квоты библиотеки: прозрачный лимит места с индикатором занятого объёма\n• Приватная аналитика — только по согласию, отключается в профиле', '2026-09-18T12:00:00Z'),
  (12, 'release', 'info', 'blue', 'Заметки и закладки', E'• Выделение текста в книге → заметка или закладка\n• Заметки с цветами подсветки, закладки с сохранением фрагмента', '2026-09-21T12:00:00Z'),
  (13, 'release', 'info', 'purple', 'Подарочные издания', E'• Классика из общественного достояния — в подарок каждому новому читателю при регистрации\n• Подарки не занимают место в квоте; баннер с авто-скрытием (3 октября)', '2026-10-01T12:00:00Z'),
  (14, 'release', 'info', 'blue', 'Голос читателя', E'• Оценка сервиса по звёздам с выбором причин и пожеланиями прямо в интерфейсе', '2026-10-12T12:00:00Z'),
  (15, 'release', 'info', 'blue', 'Мобильный опыт и мелочи', E'• Улучшенный мобильный интерфейс читателя и библиотеки; плавающая кнопка «Оцените Readora»\n• Письмо-напоминание, если email так и не подтверждён (25 октября)\n• Ссылки на Telegram-канал в футере и на «О сервисе»; корректное перечитывание книг и короткие главы', '2026-10-20T12:00:00Z'),
  (16, 'release', 'info', 'purple', 'Шесть новых форматов', E'• Добавлены MOBI (и AZW3), CBZ, TXT, Markdown и HTML — вдобавок к FB2 и EPUB\n• Понятная сводка ошибок при пакетной загрузке: «добавлено X из Y» с причиной по каждой книге', '2026-10-29T12:00:00Z'),
  (17, 'release', 'info', 'blue', 'Заметки 2.0', E'• Единый редактор заметок: форматирование, эмодзи, пять цветов\n• Сквозные заметки и закладки по всему циклу книг — с переходом в нужную книгу на нужное место\n• Вкладка «Заметки и закладки» в библиотеке: всё сразу, с поиском', '2026-10-31T12:00:00Z'),
  (18, 'release', 'info', 'purple', 'Чтение из облака', E'• Внешние хранилища: библиотека читается напрямую из Яндекс.Диска и Облака Mail.ru — файлы остаются в облаке и не занимают место на сервере\n• Синхронизация с прогрессом, паузой и детализацией ошибок по каждому файлу\n• Поддержка fb2.zip и .fbz; «перенести в облако» — освободить место, сохранив прогресс\n• Иконка «облако» на карточках облачных книг; интуитивный выбор книг и массовые действия', '2026-11-01T12:00:00Z'),
  (19, 'release', 'info', 'purple', 'Безопасное удаление аккаунта', E'• Удаление аккаунта «как на GitHub»: полное описание последствий, 8-значный код подтверждения, 30 дней на восстановление через поддержку\n• Экран блокировки входа с отсчётом до удаления, кнопкой формы обратной связи и адресом поддержки\n• Лендинг начал показывать подарочные издания вместо ручной подборки', '2026-11-05T12:00:00Z'),
  (20, 'release', 'info', 'purple', 'Оповещения и Changelog', E'• В шапке рядом с аватаром появился колокольчик с оповещениями: новости, важная информация и анонсы обновлений; число на бейдже — количество непрочитанных\n• Добавлена страница **Changelog** — полная история обновлений платформы; ссылка «Весь Changelog» внизу списка оповещений\n• Оповещения подкрашиваются цветом, чтобы их было легче различать\n• Защита от дублей: при повторной загрузке той же книги сервер отклонит дубликат; в админке — поиск и объединение дублей с сохранением прогресса, закладок и заметок', '2026-11-07T12:00:00Z')
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
SELECT setval(pg_get_serial_sequence('admin_announcements', 'id'), (SELECT COALESCE(MAX("id"), 1) FROM "admin_announcements"));
