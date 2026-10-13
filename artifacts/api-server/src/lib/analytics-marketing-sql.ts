import { sql } from "drizzle-orm";
import { bookUploadJobsTable, booksTable, readEventsTable } from "@workspace/db/schema";

// Квалифицированная ссылка на id внешней таблицы users.
//
// Drizzle рендерит `${usersTable.id}` без имени таблицы — как `"id"`. Внутри
// коррелированного подзапроса `select 1 from books as b where b.owner_user_id = "id"`
// такой столбец привязывается к таблице подзапроса (b.id), а не к users.id,
// из-за чего условие вырождается и счётчики всегда дают 0. Явное имя таблицы
// заставляет Postgres искать столбец во внешнем запросе — JOIN-семантику
// коррелированного подзапроса.
const outerUserId = sql`${sql.identifier("users")}.id`;

export const usersWithBooksSql = sql<number>`count(*) filter (where exists (
  select 1 from ${booksTable} as uploaded_book where uploaded_book.owner_user_id = ${outerUserId}
))::int`;

export const usersWithCompletedUploadsSql = sql<number>`count(*) filter (where exists (
  select 1 from ${bookUploadJobsTable} as upload_job where upload_job.owner_user_id = ${outerUserId} and upload_job.status = 'completed'
))::int`;

export const usersWithFirstReadSql = sql<number>`count(*) filter (where exists (
  select 1 from ${readEventsTable} as read_event where read_event.user_id = ${outerUserId}
))::int`;
