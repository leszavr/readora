import assert from "node:assert/strict";
import test from "node:test";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@workspace/db/schema";
import {
  usersWithCompletedUploadsSql,
  usersWithFirstReadSql,
} from "../src/lib/analytics-marketing-sql";

const { usersTable } = schema;
const db = drizzle({} as never, { schema });

function renderAggregates(): string {
  return db
    .select({
      usersWithCompletedUploads: usersWithCompletedUploadsSql,
      usersWithFirstRead: usersWithFirstReadSql,
    })
    .from(usersTable)
    .where(sql`${usersTable.createdAt} >= ${"2026-09-13"}::date`)
    .toSQL()
    .sql;
}

test("коррелированные подзапросы ссылаются на внешнюю таблицу users, а не на столбец подзапроса", () => {
  const rendered = renderAggregates();

  // Регрессия: drizzle рендерил users.id как голый "id", и условие вырождалось
  // в сравнение со столбцом подзапроса (b.id), давая всегда 0.
  assert.doesNotMatch(rendered, /owner_user_id = "id"/);
  assert.doesNotMatch(rendered, /user_id = "id"/);

  assert.match(rendered, /upload_job\.owner_user_id = "users"\.id/);
  assert.match(rendered, /read_event\.user_id = "users"\.id/);
});

test("подзапросы обращаются к успешным заданиям загрузки и фактическим сохранениям прогресса", () => {
  const rendered = renderAggregates();
  assert.match(rendered, /from "book_upload_jobs" as upload_job/);
  assert.match(rendered, /status = 'completed'/);
  assert.match(rendered, /from "read_events" as read_event/);
  assert.match(rendered, /event_type = 'progress_saved'/);
});
