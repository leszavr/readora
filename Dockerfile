# syntax=docker/dockerfile:1
# ─── Stage 1: builder ───────────────────────────────────────────────────────
FROM node:24-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.19.0 --activate

# Нативные зависимости (bcrypt, sharp)
RUN apk add --no-cache make g++ gcc python3

WORKDIR /app

# Полный контекст монорепо (так надежнее для pnpm workspaces в CI)
COPY . .

RUN pnpm install --frozen-lockfile

# Rollup in Alpine may miss optional linux-musl binary in CI locks generated on other platforms.
RUN pnpm --filter @workspace/readora exec npm i @rollup/rollup-linux-x64-musl --no-save

# Собираем все workspace-пакеты (typecheck пропускаем — за это CI)
RUN pnpm -r --if-present run build

# Выделяем prod-зависимости api-server в отдельную директорию
RUN pnpm --filter @workspace/api-server deploy --prod /deploy

# ─── Stage 2: production ────────────────────────────────────────────────────
FROM node:24-alpine AS production

RUN apk add --no-cache libstdc++ libc6-compat && \
    addgroup -g 1001 nodejs && \
    adduser -S -u 1001 -G nodejs nodejs

WORKDIR /app

# Продакшн node_modules от pnpm deploy
COPY --from=builder /deploy/node_modules ./node_modules

# Бандл бэкенда
COPY --from=builder /app/artifacts/api-server/dist ./dist

# Шаблоны писем
COPY --from=builder /app/artifacts/api-server/email-templates ./email-templates

# Статика фронтенда (сервируется Express в production)
COPY --from=builder /app/artifacts/readora/dist ./client

RUN mkdir -p uploads && chown -R nodejs:nodejs /app

USER nodejs

EXPOSE 5000

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
