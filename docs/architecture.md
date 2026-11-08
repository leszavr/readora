# Readora — архитектура платформы

> Документ описывает архитектуру Readora по состоянию на ноябрь 2026 года. Источник правды — код; при расхождении код приоритетен, а документ нужно обновить.

## Обзор

Readora — личная веб-библиотека для загрузки и чтения книг (FB2, fb2.zip/fbz, EPUB, MOBI/AZW3, CBZ, TXT, MD, HTML). TypeScript-монорепозиторий на pnpm: React/Vite SPA + Express API + PostgreSQL 16 (Drizzle ORM). Production — один Node/Express-контейнер, раздающий собранный фронтенд; деплой Docker/CapRover.

## Слои и пакеты

```text
artifacts/readora        # SPA: React 19, Vite, Tailwind, wouter, TanStack Query, shadcn/Radix-подобные компоненты
artifacts/api-server     # Express 5 API: маршруты, middlewares, сервисы, планировщики
lib/db                   # Drizzle-схема, миграции (SQL), пул подключений
lib/api-spec             # OpenAPI-спецификация — источник API-контрактов (orval-кодеген)
lib/api-client-react     # Сгенерированные React Query хуки (не редактируется вручную)
lib/api-zod              # Сгенерированные Zod-схемы (не редактируется вручную)
scripts                  # superadmin, e2e-сценарии (Playwright), rollup аналитики
docs                     # документация (этот пакет)
uploads/                 # dev-хранилище файлов книг (в production путь задаёт UPLOADS_DIR)
```

Поток данных: SPA → сгенерированный клиент (`@workspace/api-client-react`, мутатор `customFetch` с credentials) → Express `/api/*` → сервисы → Drizzle → PostgreSQL; файлы книг — в серверном хранилище (`UPLOADS_DIR`), доступ только через API с проверкой владельца.

## Ключевые архитектурные решения

- **Контракт-first API.** `lib/api-spec/openapi.yaml` — единственный источник контрактов. Изменение эндпоинта: правка спеки → `pnpm --filter @workspace/api-spec run codegen` → реализация на сервере. Клиент и Zod-схемы генерируются orval и не правятся вручную.
- **Сессии, не JWT.** Cookie-сессии express-session в таблице `user_sessions` (connect-pg-simple), rolling-продление 30 дней. Токены «Запомнить меня» (sha256-хэши в БД) восстанавливают сессию через `auto-restore-session`.
- **Файловое хранилище без direct access.** Файлы книг отдаются только через API-эндпоинты с проверкой владельца (`resolveUploadPath`); обложки — с публичным кэшированием только для опубликованных подарочных изданий.
- **Асинхронная загрузка книг.** `POST /books/upload` создаёт job (`book_upload_jobs`, статусы queued→completed/failed); парсинг метаданных/глав идёт в фоне, клиент поллит статус job'а.
- **Дедупликация по fileHash.** Повторная загрузка того же файла не создаёт копию: сервер сообщает о существующей книге, прогресс/закладки сохраняются.
- **Внешние хранилища.** Книги читаются напрямую из Яндекс.Диска (REST) и Облака Mail.ru (WebDAV); креды шифруются AES-256-GCM (`EXTERNAL_STORAGE_ENCRYPTION_KEY`). Контент кэшируется LRU-кэшем с общим и per-user бюджетами. Подарочные копии (contentBookId) ссылаются на каноническую книгу, не дублируя файлы.
- **Подарочные издания.** Только из собственных книг системного администратора (`POST /admin/gift-editions` с проверкой владельца). Выдача — копии-ссылки (contentBookId) новым пользователям при регистрации/claim.
- **SSR только для лендинга.** HTML главной и «О сервисе» рендерится на сервере (SEO) без приватных данных сессии — безопасен для кэширования. Всё остальное — SPA.

## Роли и доступ

Роли: `user`, `moderator`, `admin`.

| Middleware | Допуск | Типичные группы |
|---|---|---|
| публично | — | health, seo, лендинг, `/public/*` |
| `requireAuth` | любой активный пользователь | books, reader, cycles, annotations, external-storage, gift-claim |
| `requireAdmin` | admin + moderator | admin books/genres/stats/monitoring/announcements/landing-books |
| `requireSystemAdmin` | только admin | users, settings, SMTP, analytics, feedback, saved-emails, gift-editions (мутации) |

Модератор не может видеть приватные данные пользователей (аналитика, отзывы, письма, управление пользователями) и публиковать чужие книги.

## Фоновые планировщики (запускаются из index.ts api-server)

| Планировщик | Интервал | Назначение |
|---|---|---|
| analytics-rollup | 15 мин (выравнивание по четверти часа) | агрегация событий аналитики в суточные rollup'ы |
| unverified-accounts | ежедневно 03:00 UTC | напоминание (30 дней) и удаление (40 дней) неподтверждённых аккаунтов |
| account-deletion-purge | ежедневно 04:00 UTC | каскадная очистка данных и файлов аккаунтов после grace period |
| external-storage-maintenance | 5 мин | reaper зависших задач синхронизации облака |

Каждый отключается своей env-переменной (см. [configuration.md](configuration.md)).

## Безопасность (сводка)

- bcrypt cost 12; токены в БД хранятся как sha256-хэши; сессии инвалидируются при сбросе пароля.
- Проверка владельца ресурса на сервере для всех приватных данных (книги, прогресс, заметки, файлы).
- Приватные метаданные (ownerUserId, storage key, file hash) не покидают приватные API.
- Валидация входа Zod-схемами; rate-лимитеры на аналитике и публичных формах (по IP).
- Подробности — [security.md](security.md).
