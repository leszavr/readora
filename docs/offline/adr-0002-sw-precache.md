# ADR-0002: Service Worker precache через vite-plugin-pwa

- Статус: принято
- Дата: 2026-11-24
- Связано: ADR-0001, docs/offline/plan.md этап 2

## Контекст

Прод Readora: один Node/Express-контейнер (Docker, CapRover). Vite собирает фронтенд
двумя проходами: client-бандл в `dist/public` (Express раздаёт его как статику,
SPA-роуты — инлайн-HTML на базе `index.html` с заменённой meta robots) и SSR-бандл
лендинга в `dist/server`. Service Worker сейчас — заглушка без кэширования.

Для офлайн-режима нужен precache app shell: бандл-ассеты имеют content-hash
(`/assets/[hash].js`), поэтому список для precache можно получить только на этапе
сборки. Варианты: `vite-plugin-pwa` (обёртка над Workbox generateSW/injectManifest)
или ручной SW с самописной генерацией манифеста.

## Решение

Используем `vite-plugin-pwa` (devDependency только `@workspace/readora`):

1. `strategies: "generateSW"`, `registerType: "autoUpdate"` (skipWaiting +
   clientsClaim встроены), `filename: "sw.js"` — существующая регистрация в
   `main.tsx` продолжает работать, `injectRegister: false`.
2. Плагин включается **только в client-проход** билда (`isSsrBuild` из config env
   Vite); SSR-проход лендинга SW не генерирует.
3. Precache: JS/CSS/HTML + публичные иконки/шрифты (глобальный лимит Workbox
   2 МБ на файл — крупные медиа лендинга остаются в runtime/network).
4. Runtime-кэш — **только навигации** (SPA-роуты), network-first с fallback на
   precache `index.html`. `/api/*` SW не перехимывает и не кэширует никогда:
   приватные данные (книги, обложки, прогресс) живут в IndexedDB офлайн-модуля,
   не в Cache Storage.
5. `cleanupOutdatedCaches: true` — после деплоя старые precache-кэши удаляются;
   это согласовано с существующим механизмом восстановления при устаревшем чанке.
6. Заглушка `public/sw.js` удаляется (её место занимает сгенерированный SW).

## Рассмотренные альтернативы

- **Ручной SW с post-build скриптом** — дублирует функциональность Workbox
  (precache-манифест, инвалидация по ревизиям, cleanup), требует поддержки при
  каждом изменении билда. Отклонён.
- **injectManifest (кастомный SW на Workbox-модулях)** — нужен только при сложной
  runtime-логике; наш SW-слой тонкий (precache + одна route). Отклонён как
  оверинжиниринг, эволюция возможна без смены зависимости.
- **Кэшировать `/api/*` в SW runtime-кэш** — приватные данные в Cache Storage
  без учёта владельца; обходится очисткой на logout, но не нужен: офлайн-данные
  уже в IndexedDB. Отклонён.

## Последствия

- Новая devDependency `vite-plugin-pwa` (+ транзитивные workbox-пакеты только
  в dev-окружении фронтенда; в прод-контейнер идут только собранные файлы).
- Прод-деплой не меняется: сгенерированный `dist/public/sw.js` раздаётся Express
  как статика; Dockerfile/CapRover без изменений.
- Обновление SW происходит при следующем открытии приложения после деплоя
  (autoUpdate); навигации network-first — свежий HTML имеет приоритет.
- При logout/смене аккаунта очистке подлежат не только IndexedDB, но и caches
  precache-а (app shell — публичный, но во избежание остатков navigation-кэшей
  чистим всё; см. план этап 6).
