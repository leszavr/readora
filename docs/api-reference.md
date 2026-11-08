# Readora — справочник API

> Полный машинно-читаемый контракт: `lib/api-spec/openapi.yaml` (источник правды). Этот документ — обзор групп эндпоинтов и уровней доступа. Все маршруты — под префиксом `/api`.

## Аутентификация

Cookie-сессия `readora.sid` (httpOnly, sameSite=lax). Все приватные запросы — с `credentials: "include"`. Неавторизованные — `401`, недостаточная роль — `403`.

Обозначения доступа: **публ.** — без авторизации; **auth** — `requireAuth`; **admin** — admin или moderator; **sysadmin** — только admin.

## auth (`/auth`)

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| POST | `/auth/register` | публ. | Регистрация (+ согласие на аналитику, referral source) |
| POST | `/auth/login` | публ. | Вход (rememberMe) |
| POST | `/auth/logout` | публ. | Выход |
| POST | `/auth/forgot-password` | публ. | Запрос сброса пароля |
| POST | `/auth/reset-password` | публ. | Сброс пароля по токену |
| POST | `/auth/resend-verification` | публ. | Повторное письмо подтверждения |
| GET | `/auth/verify/:token` | публ. | Подтверждение email |
| GET | `/auth/confirm-password-change/:token` | публ. | Подтверждение смены пароля |
| GET | `/auth/yandex`, `/auth/yandex/callback` | публ. | Вход через Яндекс ID |
| GET | `/auth/vk/config`, `/auth/vk`, `/auth/vk/callback` | публ. | Вход через VK ID |
| GET | `/auth/me` | auth | Текущий пользователь |
| PATCH | `/auth/me/settings` | auth | Настройки профиля (вкл. отказ от аналитики) |
| POST | `/auth/me/password` | auth | Смена пароля (с подтверждением по email) |
| GET | `/auth/me/delete/preview` | auth | Последствия удаления аккаунта + код подтверждения |
| POST | `/auth/me/delete` | auth | Отложенное удаление аккаунта (grace period 30 дней) |
| GET/DELETE | `/auth/trusted-devices[/:id]` | auth | Управление устройствами «Запомнить меня» |

## books (`/books`)

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/books` | auth | Список книг (фильтры, поиск) |
| GET | `/books/storage-quota` | auth | Квота библиотеки |
| POST | `/books/upload` | auth | Загрузка файла (multipart) → async job |
| GET | `/books/upload-jobs/:id` | auth | Статус job загрузки |
| GET | `/books/:id`, `/books/:id/cover` | auth | Книга / обложка |
| PATCH | `/books/:id` | auth | Метаданные, обложка, назначение в цикл |
| DELETE | `/books/:id`, POST `/books/delete-bulk` | auth | Удаление |
| POST | `/books/assign-cycle` | auth | Массовое назначение в цикл |
| GET | `/public/popular-books` | публ. | Подборка для лендинга |

## reader (`/books/:id/…`, `/reader`)

| Метод | Путь | Доступ | Назначение |
|---|---|---|---|
| GET | `/books/:id/chapters[/:chapterId]` | auth | Главы / глава |
| GET/PUT | `/books/:id/progress` | auth | Прогресс чтения (семантическая позиция) |
| POST | `/books/:id/complete`, `/books/:id/reopen` | auth | Отметить прочитанной / перечитывать |
| GET/PUT/DELETE | `/reader/settings` | auth | Настройки ридера (тема, шрифт; per device mode) |
| POST/GET/PATCH/DELETE | `/books/:id/bookmarks…` | auth | Закладки |
| POST/GET/PATCH/DELETE | `/books/:id/notes…` | auth | Заметки |

## Прочие пользовательские

- `GET /genres` — публ.; мутации жанров — admin.
- `GET/POST /cycles` — auth (циклы).
- `GET /annotations/notes`, `GET /annotations/bookmarks` — auth (сквозные заметки/закладки по циклам).
- `POST /analytics/events/batch` — auth + rate limiter (приватная продуктовая аналитика, только с согласия).
- `POST /feedback`, `GET /feedback/survey`, `POST /feedback/survey` — публ. (limiter); `GET /feedback/survey/eligibility` — auth.
- `GET /gift-editions/available`, `POST /gift-editions/claim` — auth; `GET /public/gift-book-covers/:bookId` — публ.
- `POST /pwa/install-accepted` — публ. (limiter).
- `GET /announcements`, `/announcements/changelog`, `POST /announcements/read-all`, `/announcements/:id/read` — auth.

## external-storage (`/external-storage`) — auth

Подключения (Яндекс.Диск OAuth: `GET …/yandex/connect`; Mail.ru WebDAV: `POST …/connections/mailru`), список/патч/удаление подключений, обзор папок, запуск синхронизации (`POST …/connections/:id/sync`), статусы job'ов и ошибки, релокации книг в облако и их resolve.

## admin (`/admin`)

| Группа | Доступ | Содержимое |
|---|---|---|
| Мониторинг | admin | `GET /admin/stats`, `/admin/system-metrics`, `/admin/online-users` |
| Книги | admin | список с giftEditionId, дубликаты, дедупликация, скачивание, блокировка, удаление |
| Жанры | admin | CRUD |
| Оповещения | admin | CRUD, архив, пакетное удаление, счётчик читателей |
| Лендинг-книги | admin | CRUD + обложки |
| PWA | admin | `GET /admin/pwa-stats` |
| Аналитика | sysadmin | `GET /admin/analytics`, `/admin/analytics/users` |
| Пользователи | sysadmin | CRUD, verify-email, смена пароля, блокировка, restore/purge |
| Настройки и SMTP | sysadmin | `GET/PATCH /admin/settings`, `POST /admin/smtp/test`, saved-emails |
| Отзывы | sysadmin | `GET/DELETE /admin/feedback` |
| Внешние хранилища | sysadmin | статистика, управление sync-job'ами, сброс кэша |
| Подарочные издания | sysadmin (мутации) | создать (только из своей книги!), патч, удалить; список — admin |

## Служебные (публичные)

- `GET /healthz` — health-check (используется после деплоя).
- `GET /robots.txt`, `GET /sitemap.xml` — SEO.
- `GET /public/maintenance-status`, `GET /public/registration-status` — статусы для лендинга.
