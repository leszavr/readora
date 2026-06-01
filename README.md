# Readora

> Личная веб-библиотека для чтения книг в форматах **FB2** и **EPUB**. Хранение, организация, чтение в браузере. Интерфейс полностью на русском языке.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A524-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-%E2%89%A510-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

---

## Возможности

- **Загрузка книг FB2 и EPUB** (до 50 МБ) с автоматическим извлечением метаданных, обложки и оглавления
- **Личная библиотека** с фильтрами по жанру, статусу чтения и полнотекстовым поиском
- **Ридер в браузере** с настройками шрифта, размера, темы, ширины колонки и автосохранением прогресса чтения
- **Циклы и серии** — объединение книг автора в серии с порядковыми номерами
- **Роли пользователей** — `user`, `moderator`, `admin`
- **Подтверждение email и сброс пароля** через настраиваемый SMTP
- **Админ-панель** — статистика, управление пользователями, книгами, жанрами и SMTP
- **Cookie-сессии** в Postgres, bcrypt cost 12, защита от прямого доступа к файлам книг

## Технологический стек

| Слой | Технологии |
|------|------------|
| Frontend | React 19, Vite 7, TanStack Query, wouter, Tailwind CSS v4, shadcn/ui |
| Backend | Node.js 24, Express 5, express-session, multer, nodemailer, sharp |
| База данных | PostgreSQL 16, Drizzle ORM, версионированные миграции |
| Валидация | Zod (`zod/v4`), `drizzle-zod` |
| API codegen | OpenAPI 3.1 + Orval → React Query хуки, Zod-схемы |
| Парсинг книг | fast-xml-parser (FB2), adm-zip + cheerio (EPUB) |
| Инфраструктура | pnpm workspaces, esbuild, Docker Compose |

## Структура репозитория

```
readora/
├── artifacts/
│   ├── api-server/          # Express API
│   └── readora/             # React + Vite фронтенд
├── lib/
│   ├── api-spec/            # OpenAPI спецификация (источник истины)
│   ├── api-client-react/    # Сгенерированные React Query хуки
│   ├── api-zod/             # Сгенерированные Zod схемы
│   └── db/                  # Схема и миграции (Drizzle)
├── scripts/                 # Вспомогательные скрипты
├── docker-compose.yml       # PostgreSQL для локальной разработки
└── pnpm-workspace.yaml
```

## Быстрый старт

### Требования

- **Node.js 24+**
- **pnpm 10+** (`npm install -g pnpm`)
- **Docker** + Docker Compose *(или локальный PostgreSQL 16)*

### Установка

```bash
git clone https://github.com/leszavr/readora.git
cd readora
pnpm install
cp .env.example .env
# отредактируйте .env: как минимум сгенерируйте SESSION_SECRET
```

Сгенерировать `SESSION_SECRET`:

```bash
openssl rand -hex 32
```

### Поднять базу данных

```bash
docker compose up -d postgres
```

### Применить миграции

```bash
pnpm run db:migrate
```

### Запустить в режиме разработки

В двух терминалах:

```bash
pnpm run dev:server   # API → http://localhost:8080
pnpm run dev:client   # Frontend → http://localhost:3000
```

Откройте <http://localhost:3000>, зарегистрируйтесь, загрузите первую книгу.

### Создать администратора

Первый зарегистрированный пользователь получает роль `user`. Чтобы повысить до `admin`:

```bash
docker exec -it readora-postgres-1 psql -U readora -d readora \
  -c "UPDATE users SET role='admin' WHERE email='your@email.com';"
```

## Скрипты

| Команда | Назначение |
|---------|------------|
| `pnpm run dev:server` | API сервер с hot-reload |
| `pnpm run dev:client` | Vite dev-сервер фронтенда |
| `pnpm run typecheck` | Проверка типов всех пакетов |
| `pnpm run build` | Полная сборка (типы + esbuild + Vite) |
| `pnpm run db:generate` | Сгенерировать миграцию из изменений схемы |
| `pnpm run db:migrate` | Применить миграции к БД |
| `pnpm run db:sync` | `drizzle-kit push` для быстрых dev-итераций |

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|------------|--------------|-----------|
| `NODE_ENV` | `development` | Режим работы |
| `PORT` | `8080` | Порт API |
| `APP_ORIGIN` | `http://localhost:3000` | CORS origin фронтенда |
| `DATABASE_URL` | — | Строка подключения к Postgres (обязательно) |
| `SESSION_SECRET` | — | Секрет для cookie-сессий (обязательно в проде) |
| `UPLOADS_DIR` | `./uploads` | Каталог хранения файлов книг |
| `LOG_LEVEL` | `info` | Уровень pino-логов |
| `BASE_PATH` | `/` | Префикс фронта при деплое в подпапке |

**SMTP** настраивается через админ-панель, а не через env (хранится в БД).

## Архитектурные решения

- **Cookie-сессии** в Postgres (express-session) — простота logout, не нужен JWT
- **Дедупликация по SHA-256** — повторная загрузка той же книги переиспользует существующий файл
- **Парсинг при загрузке** — главы FB2/EPUB конвертируются в HTML и сохраняются в БД для быстрого чтения
- **Sharp для обложек** — конвертация в WebP с фиксированной шириной
- **OpenAPI → код** — Zod-схемы и React Query хуки генерируются Orval, обеспечивая end-to-end типобезопасность
- **Versioned миграции** Drizzle — БД-схема всегда воспроизводима

## Roadmap

- Полнотекстовый поиск по содержимому (pg_trgm)
- Аудит-лог админских действий
- Резервное копирование БД и загрузок
- Сборка Docker-образа и публикация на CapRover
- Lazy-loading глав в ридере для крупных книг
- Тёмная тема ридера с пользовательскими палитрами

## Вклад в проект

См. [CONTRIBUTING.md](./CONTRIBUTING.md). Issues и Pull Requests приветствуются.

## Лицензия

[MIT](./LICENSE)
