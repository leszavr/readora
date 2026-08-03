# Readora

Личная библиотека книг — веб-приложение для хранения, управления и чтения книг в форматах FB2 и EPUB. Весь интерфейс на русском языке.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — запуск API сервера (порт 8080)
- `pnpm --filter @workspace/readora run dev` — запуск фронтенда
- `pnpm run typecheck` — полная проверка типов
- `pnpm run build` — typecheck + сборка всех пакетов
- `pnpm --filter @workspace/api-spec run codegen` — регенерация API хуков и Zod схем из OpenAPI спека
- `pnpm --filter @workspace/db run push` — применение изменений схемы БД (только для разработки)
- Required env: `DATABASE_URL` — Postgres connection string, `SESSION_SECRET` — секрет сессий

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React 19 + Vite + Tailwind CSS v4 + shadcn/ui + wouter
- API: Express 5 + express-session + multer
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)
- Book parsing: fast-xml-parser (FB2), adm-zip + cheerio (EPUB)

## Where things live

- `lib/api-spec/openapi.yaml` — OpenAPI спецификация (источник истины для API)
- `lib/api-client-react/src/generated/` — сгенерированные React Query хуки
- `lib/api-zod/src/generated/` — сгенерированные Zod схемы
- `lib/db/src/schema/` — схемы БД (Drizzle ORM)
- `artifacts/api-server/src/routes/` — маршруты бэкенда
- `artifacts/api-server/src/lib/parser.ts` — парсер FB2/EPUB
- `artifacts/readora/src/pages/` — страницы фронтенда
- `artifacts/readora/src/components/` — переиспользуемые компоненты

## Architecture decisions

- **Сессии через express-session** (cookie-based) — не JWT, т.к. не нужен SSR и проще logout
- **Multer с memoryStorage** — файлы обрабатываются в памяти, затем парсятся и сохраняются на диск в `uploads/`
- **Файловый хэш (SHA256)** — уникальный ключ хранения книги, дедупликация на уровне файлов
- **Парсинг при загрузке** — FB2/EPUB парсятся сразу при загрузке, главы сохраняются в БД как HTML
- **Admin роутер без prefix** — admin.ts уже содержит `/admin/` в путях маршрутов, монтируется без префикса в index.ts

## Product

- Регистрация/вход/выход с ролями (user/moderator/admin)
- Загрузка книг FB2 и EPUB (до 50 МБ) с автоматическим извлечением метаданных
- Личная библиотека с фильтрами по жанру, статусу чтения, поиском
- Ридер с настройками (шрифт, размер, тема, ширина), оглавлением, сохранением прогресса
- Панель администратора (статистика, управление пользователями и книгами, настройки)

## User preferences

- Весь UI строго на русском языке
- Без эмодзи в интерфейсе

## Gotchas

- **Admin routes** — роутер admin.ts монтируется без "/admin" prefix в index.ts (пути уже включают /admin/)
- **Session** — SESSION_SECRET обязателен в env для продакшена
- **File upload** — использует raw `fetch` с FormData, не генерированный хук (Multer несовместим с JSON)
- **?? с ||** — нужны скобки для disambiguate: `a ?? (b || c)`, не `a ?? b || c`
- **DB push** — `pnpm --filter @workspace/db run push` для dev, `push-force` если конфликты

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
