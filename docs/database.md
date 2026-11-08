# Readora — база данных

> Схема: `lib/db/src/schema/` (Drizzle, источник правды). Миграции: `lib/db/migrations/` — версионированный SQL, 0000–0032. Не изменяйте применённые миграции; новая миграция — `pnpm run db:generate` после правки схемы.

## ER-обзор по доменам

### Пользователи и доступ
- `users` — аккаунты: email (bcrypt-пароль), username, роль (`user`/`moderator`/`admin`), статус, квота, флаги аналитики, `lastLoginAt`.
- `user_sessions` — cookie-сессии express-session (sid, sess JSON, expire).
- `remember_tokens` — токены «Запомнить меня» (sha256-хэш, привязка к устройству).
- `email_verification_tokens`, `password_reset_tokens`, `password_change_tokens` — одноразовые токены писем (sha256).
- `account_deletion_log` — помеченные на удаление аккаунты (grace period, причина).
- `unverified_account_cleanup_log` — напоминания/удаления неподтверждённых аккаунтов.

### Библиотека
- `books` — книги: формат (fb2/epub/mobi/cbz/txt/md/html), статус (active/blocked), title/author/description, cover, `storageKey`, `fileHash`, `fileSize`, `contentBookId` (ссылка подарочной копии на каноническую книгу), `ownerUserId`.
- `chapters` — главы + статус парсинга (pending/done/error).
- `genres`, `book_genres` — справочник жанров и связь m2m.
- `cycles` — циклы; порядок книги в цикле — в `books` (cycleName/cycleNumber).
- `book_upload_jobs` — асинхронные задачи загрузки (queued→completed/failed).
- `reading_progress` — прогресс: глава, позиция (семантический якорь), статус (not_started/reading/finished).
- `reader_settings` — настройки ридера per user + device mode (desktop/mobile).
- `bookmarks`, `notes` — закладки и заметки с цитатным контекстом и цветами.
- `read_events` — события чтения для статистики.

### Подарочные издания и лендинг
- `gift_editions` — каталог подарочных изданий (bookId, sortOrder, isPublished); эталон всегда в библиотеке админа.
- `landing_books` — ручная подборка для лендинга (историческая; сейчас лендинг показывает подарочные издания).

### Внешние хранилища
- `external_storage_connections` — подключения пользователей (провайдер yandex_disk/mail_ru_cloud; креды AES-256-GCM).
- задачи синхронизации (sync jobs, статусы, ошибки по файлам) и релокации (перенос локальной книги в облако по fileHash).

### Коммуникации и метрики
- `admin_announcements` — оповещения (kind announcement/release, severity, color, archivedAt).
- `user_announcement_reads` — отметки прочтения оповещений.
- `feedback_responses`, `feedback_prompt_states` — оценки сервиса и состояния показа опроса.
- `analytics_events` + суточные rollup-таблицы (`analytics_daily_*`, `analytics_reader_sessions`) — приватная продуктовая аналитика.
- `app_settings` — KV-настройки: maintenanceMode, allowRegistration, SMTP, квоты, бюджеты кэша.

## Инварианты, которые надо сохранять

1. **Подарочная копия** (books с `contentBookId != null`) не владеет файлом: файл и главы — у канонической книги. Удаление канонической книги запрещено, пока есть копии вне удаляемого набора (`hasGiftCopiesOutside`).
2. **`fileHash`** — основа дедупликации: повторная загрузка того же файла не создаёт книгу; релокация в облако сохраняет hash.
3. **Каскады**: удаление пользователя/аккаунта чистит books, progress, notes, bookmarks, connections, analytics — по планировщику account-deletion-purge.
4. **Миграции не запускаются из application startup** — только `pnpm run db:migrate` в процессе деплоя.

## Ключевые миграции (вехи)

0003 upload jobs · 0005 SMTP settings · 0008 remember tokens · 0015 storage quota · 0016 Yandex OAuth · 0017–0018 bookmarks/notes · 0019 gift editions · 0024 unverified cleanup · 0025 новые форматы · 0026–0029 внешние хранилища · 0030 sha256 auth-токены · 0031 отложенное удаление аккаунта · 0032 админ-оповещения.
