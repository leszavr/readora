# Contributing to Readora

Спасибо за интерес к проекту! Этот документ описывает базовые правила работы с кодом.

## Окружение

- Node.js **24+**, pnpm **10+**
- PostgreSQL **16** (проще всего поднять через `docker compose up -d postgres`)
- Скопируйте `.env.example` в `.env` и заполните значения

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres
pnpm run db:migrate
pnpm run dev:server   # терминал 1
pnpm run dev:client   # терминал 2
```

## Перед коммитом

```bash
pnpm run typecheck   # 0 ошибок
pnpm run build       # сборка всех пакетов
```

## Стиль кода

- TypeScript strict, без `any`
- Все строки UI — на русском языке, без эмодзи в интерфейсе
- ESM модули, импорты `node:*` для встроенных пакетов
- Форматирование — Prettier (запускается автоматически в VS Code)
- Линт — SonarLint + встроенные правила TypeScript

## Структура монорепо

| Путь | Назначение |
|------|------------|
| `artifacts/api-server` | Express API |
| `artifacts/readora` | React-фронтенд (Vite) |
| `lib/db` | Схема БД и миграции (Drizzle) |
| `lib/api-spec` | OpenAPI-спецификация (источник истины) |
| `lib/api-client-react` | Сгенерированные React Query хуки |
| `lib/api-zod` | Сгенерированные Zod-схемы |
| `scripts` | Вспомогательные скрипты |

## Миграции БД

1. Измените схему в `lib/db/src/schema/`
2. Сгенерируйте миграцию: `pnpm run db:generate`
3. Просмотрите SQL в `lib/db/migrations/` и при необходимости поправьте
4. Примените: `pnpm run db:migrate`

## Pull Requests

- Один PR — одна логическая задача
- Опишите изменения и причину
- Убедитесь, что `pnpm run typecheck` и `pnpm run build` зелёные
- Не коммитьте `.env`, `uploads/`, `dist/`, `node_modules/`

## Сообщения о багах

Создавайте issue с описанием шагов воспроизведения, ожидаемого и фактического поведения, версии Node/pnpm и логов (`logs/`).
