# syntax=docker/dockerfile:1
# ─── Stage 1: builder ───────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS builder

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate

# Нативные зависимости (bcrypt, sharp) и шрифты для обработки обложек.
RUN apt-get update && apt-get install -y --no-install-recommends make g++ python3 ca-certificates fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Полный контекст монорепо (так надежнее для pnpm workspaces в CI)
COPY . .

RUN pnpm install --frozen-lockfile

# Собираем все workspace-пакеты (typecheck пропускаем — за это CI)
RUN pnpm -r --if-present run build

# Выделяем prod-зависимости api-server в отдельную директорию
RUN pnpm --config.minimumReleaseAge=0 --filter @workspace/api-server deploy --legacy --prod /deploy

# Мигратор запускается напрямую, поэтому ему нужен собственный набор runtime-зависимостей.
RUN pnpm --config.minimumReleaseAge=0 --filter @workspace/db deploy --legacy --prod /db-deploy

# ─── Stage 2: production ────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS production

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/* && \
    groupadd --gid 1001 nodejs && \
    useradd --uid 1001 --gid nodejs --create-home --shell /usr/sbin/nologin nodejs

WORKDIR /app

# Продакшн node_modules от pnpm deploy
COPY --from=builder /deploy/node_modules ./node_modules

# Бандл бэкенда
COPY --from=builder /app/artifacts/api-server/dist ./dist

# Шаблоны писем
COPY --from=builder /app/artifacts/api-server/email-templates ./email-templates

# Статика фронтенда (сервируется Express в production)
COPY --from=builder /app/artifacts/readora/dist/public ./client

# SSR-бандл лендинга, выполняемый тем же Express-процессом.
COPY --from=builder /app/artifacts/readora/dist/server ./client-server

# Unified migration runner и SQL-миграции. Сохраняем структуру lib/db: runner
# определяет каталог SQL относительно собственного расположения. Он запускается
# перед каждым стартом контейнера; журнал БД пропускает уже применённые миграции.
COPY --from=builder /app/lib/db/scripts/migrate-unified.mjs ./lib/db/scripts/migrate-unified.mjs
COPY --from=builder /app/lib/db/migrations ./lib/db/migrations
COPY --from=builder /db-deploy/node_modules ./lib/db/node_modules

# Каталоги для загрузок с владельцем nodejs.
# Создаём оба возможных пути (UPLOADS_DIR в проде = /captain/data/uploads),
# чтобы non-root процесс не падал на mkdir, а named-volume CapRover
# (если будет подключён) унаследовал владельца nodejs от образа.
RUN mkdir -p /app/uploads/covers /app/uploads/tmp \
             /captain/data/uploads/covers /captain/data/uploads/tmp && \
    chown -R nodejs:nodejs /app /captain

USER nodejs

EXPOSE 5000

CMD ["sh", "-c", "node ./lib/db/scripts/migrate-unified.mjs apply && exec node --enable-source-maps ./dist/index.mjs"]
