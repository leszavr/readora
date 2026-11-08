# Readora — конфигурация и развёртывание

## Переменные окружения

### Обязательные

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | Подключение PostgreSQL 16 |
| `SESSION_SECRET` | Секрет cookie-сессий (обязателен в production) |
| `UPLOADS_DIR` | Каталог файлового хранилища книг (default `./uploads`) |

### Основные

| Переменная | Default | Назначение |
|---|---|---|
| `PORT` | 8080 | Порт API |
| `APP_ORIGIN` | — | CORS-origin фронтенда; база ссылок в письмах и OAuth-redirect |
| `APP_BASE_URL` | — | База URL email-сервиса |
| `PUBLIC_BASE_URL` | `APP_ORIGIN` | Публичные SEO-URL (robots/sitemap) |
| `LOG_LEVEL` | info | Уровень pino-логов |
| `NODE_ENV` | — | development/production |

### Интеграции

| Переменная | Назначение |
|---|---|
| `YANDEX_CLIENT_ID` / `YANDEX_CLIENT_SECRET` | Yandex OAuth: вход + Яндекс.Диск (scope `cloud_api:disk.read`) |
| `VK_CLIENT_ID` / `VK_CLIENT_SERVICE_TOKEN` | VK ID OAuth |
| `EXTERNAL_STORAGE_ENCRYPTION_KEY` | 64 hex-символа, AES-256-GCM для кредов внешних хранилищ |
| `ADMIN_EMAIL` / `ADMIN_USERNAME` / `ADMIN_PASSWORD` | Одноразовый запуск `create-superadmin` |
| `E2E_BASE_URL` | Цель e2e-прогонов (scripts) |

### Планировщики (вкл/выкл)

| Переменная | Default | Управляет |
|---|---|---|
| `ANALYTICS_ROLLUP_ENABLED` | true | rollup аналитики (каждые 15 мин) |
| `UNVERIFIED_ACCOUNTS_CLEANUP_ENABLED` | true | напоминания/удаление неподтверждённых (03:00 UTC) |
| `ACCOUNT_DELETION_PURGE_ENABLED` | true | очистка удалённых аккаунтов (04:00 UTC) |

## Локальная разработка

```bash
pnpm install
pnpm run db:migrate            # применить миграции
pnpm run dev:server            # Express API
pnpm run dev:client            # Vite (PORT=3000)
pnpm run typecheck             # все пакеты
pnpm --filter @workspace/api-server test   # node:test
```

Суперадмин: `pnpm --filter @workspace/scripts start:create-superadmin` (или env-переменные выше).

## Production (Docker/CapRover)

- Образ собирается из `Dockerfile` (Node 24+, pnpm deploy, workspace-сборка); фронтенд собирается Vite и раздаётся Express из `client`.
- Миграции применяются командой `pnpm run db:migrate` в процессе деплоя — **не** из application startup.
- После выката — health-check `GET /healthz`.
- Один контейнер: приложение, клиентская статика, планировщики. PostgreSQL — внешний.

## Настройки приложения (app_settings, через админку)

Режим обслуживания (включение массово завершает сессии пользователей), разрешение регистрации, SMTP (хост/порт/учётка/from, тест письма, сохранённые письма), квоты библиотек (default и границы), лимит размера файла книги, бюджеты кэша внешних хранилищ (общий/per-user).

## Мониторинг

- `GET /healthz` — liveness.
- Админка → Обзор: метрики сервера (CPU/RAM/диск/uptime, автообновление 30с), пользователи онлайн (15с), статистика платформы.
- Логи: pino (`LOG_LEVEL`); секреты, содержимое книг и приватные метаданные в логи не пишутся.
