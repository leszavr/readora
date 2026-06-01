# syntax=docker/dockerfile:1
# ─── Stage 1: builder ───────────────────────────────────────────────────────
FROM node:24-alpine AS builder

ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

# Нативные зависимости (bcrypt, sharp)
RUN apk add --no-cache make g++ gcc python3

WORKDIR /app

# Копируем только манифесты для кеша слоёв
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json tsconfig.json ./
COPY lib/db/package.json                 lib/db/
COPY lib/api-zod/package.json            lib/api-zod/
COPY lib/api-client-react/package.json   lib/api-client-react/
COPY lib/api-spec/package.json           lib/api-spec/
COPY artifacts/api-server/package.json  artifacts/api-server/
COPY artifacts/readora/package.json     artifacts/readora/
COPY scripts/package.json               scripts/

RUN pnpm install --frozen-lockfile

# Исходный код
COPY . .

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
