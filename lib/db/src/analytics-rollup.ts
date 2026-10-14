import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./client";

const ROLLUP_LOCK_KEY = "readora-analytics-rollup-v1";
const DEFAULT_BATCH_SIZE = 366;
const RETENTION_DELETE_BATCH_SIZE = 10_000;
const SESSION_FINALIZATION_TIMEOUT_MINUTES = 10;

type LockRow = { acquired: boolean };
type ActivityDateRow = { activityDate: string };
type TimedOutSessionRow = {
  sessionId: string;
  userId: number;
  bookId: number;
  deviceMode: string;
  startedAt: Date;
  lastSeenAt: Date;
  activeReadingMs: number;
};

export type AnalyticsRollupResult = {
  processedDates: string[];
  retentionDeleted: number;
  skipped: boolean;
};

function assertActivityDate(activityDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate) || Number.isNaN(Date.parse(`${activityDate}T00:00:00Z`))) {
    throw new Error("Дата аналитики должна быть в формате YYYY-MM-DD");
  }
}

async function rebuildAnalyticsDay(client: PoolClient, activityDate: string): Promise<void> {
  await client.query("delete from analytics_daily_user_activity where activity_date = $1::date", [activityDate]);
  await client.query("delete from analytics_daily_book_activity where activity_date = $1::date", [activityDate]);

  await client.query(
    `
      insert into analytics_daily_user_activity (
        activity_date, user_id, device_mode, app_opens, reader_sessions,
        reader_session_starts, reader_session_ends, active_reading_ms,
        books_started, books_completed, sync_attempts, sync_successes
      )
      select
        event_day,
        user_id,
        device_mode,
        count(*) filter (where event_name = 'app_opened')::int,
        count(*) filter (where event_name = 'reader_session_ended')::int,
        count(*) filter (where event_name = 'reader_session_started')::int,
        count(*) filter (where event_name = 'reader_session_ended')::int,
        coalesce(sum((properties->>'activeReadingMs')::bigint) filter (where event_name = 'reader_session_ended'), 0),
        count(*) filter (where event_name = 'reader_session_started' and coalesce((properties->>'startProgressPct')::numeric, 0) = 0)::int,
        count(*) filter (where event_name = 'book_completed')::int,
        count(*) filter (where event_name = 'progress_sync_finished')::int,
        count(*) filter (where event_name = 'progress_sync_finished' and properties->>'outcome' = 'success')::int
      from analytics_events
      where event_day = $1::date
      group by event_day, user_id, device_mode
    `,
    [activityDate],
  );

  await client.query(
    `
      insert into analytics_daily_book_activity (
        activity_date, book_id, readers, reader_sessions, reader_session_starts,
        reader_session_ends, active_reading_ms, starts, completions
      )
      select
        event_day,
        book_id,
        count(distinct user_id)::int,
        count(*) filter (where event_name = 'reader_session_ended')::int,
        count(*) filter (where event_name = 'reader_session_started')::int,
        count(*) filter (where event_name = 'reader_session_ended')::int,
        coalesce(sum((properties->>'activeReadingMs')::bigint) filter (where event_name = 'reader_session_ended'), 0),
        count(*) filter (where event_name = 'reader_session_started' and coalesce((properties->>'startProgressPct')::numeric, 0) = 0)::int,
        count(*) filter (where event_name = 'book_completed')::int
      from analytics_events
      where event_day = $1::date and book_id is not null
      group by event_day, book_id
    `,
    [activityDate],
  );
}

async function finalizeInactiveReaderSessions(client: PoolClient): Promise<void> {
  await client.query("begin");
  try {
    const timedOut = await client.query<TimedOutSessionRow>(
      `
        update analytics_reader_sessions
        set ended_at = last_seen_at
        where ended_at is null
          and last_seen_at < now() - make_interval(mins => $1)
        returning
          session_id as "sessionId",
          user_id as "userId",
          book_id as "bookId",
          device_mode as "deviceMode",
          started_at as "startedAt",
          last_seen_at as "lastSeenAt",
          active_reading_ms as "activeReadingMs"
      `,
      [SESSION_FINALIZATION_TIMEOUT_MINUTES],
    );

    for (const session of timedOut.rows) {
      const activityDate = session.lastSeenAt.toISOString().slice(0, 10);
      await client.query(
        `
          insert into analytics_events (
            event_id, user_id, book_id, event_name, producer, occurred_at,
            event_day, occurred_local_date, session_id, platform, device_mode, properties
          ) values (
            $1::uuid, $2, $3, 'reader_session_ended', 'server', $4::timestamptz,
            $5::date, $5::date, $6::uuid, 'web', $7,
            jsonb_build_object(
              'startProgressPct', 0,
              'endProgressPct', 0,
              'maxProgressPct', 0,
              'activeReadingMs', $8::bigint,
              'endReason', 'timeout'
            )
          )
        `,
        [
          crypto.randomUUID(),
          session.userId,
          session.bookId,
          session.lastSeenAt,
          activityDate,
          session.sessionId,
          session.deviceMode,
          session.activeReadingMs,
        ],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function rebuildQueuedDay(client: PoolClient, activityDate: string): Promise<boolean> {
  await client.query("begin");
  try {
    // Delete the queue marker before calculating. An event inserted concurrently
    // creates a new marker, so its day is rebuilt again on the next run.
    const claimed = await client.query(
      "delete from analytics_rollup_queue where activity_date = $1::date returning activity_date",
      [activityDate],
    );
    if (claimed.rowCount === 0) {
      await client.query("commit");
      return false;
    }

    await rebuildAnalyticsDay(client, activityDate);
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function deleteExpiredRawEvents(client: PoolClient): Promise<number> {
  const result = await client.query(
    `
      delete from analytics_events
      where ctid in (
        select event.ctid
        from analytics_events as event
        where event.received_at < now() - interval '13 months'
          and not exists (
            select 1
            from analytics_rollup_queue as queue
            where queue.activity_date = event.event_day
          )
        order by event.received_at asc
        limit $1
      )
    `,
    [RETENTION_DELETE_BATCH_SIZE],
  );
  return result.rowCount ?? 0;
}

async function tryAcquireRollupLock(client: PoolClient): Promise<boolean> {
  const result = await client.query<LockRow>(
    "select pg_try_advisory_lock(hashtext($1)) as acquired",
    [ROLLUP_LOCK_KEY],
  );
  return result.rows[0]?.acquired === true;
}

async function releaseRollupLock(client: PoolClient): Promise<void> {
  await client.query("select pg_advisory_unlock(hashtext($1))", [ROLLUP_LOCK_KEY]);
}

export async function rollupAnalyticsDay(activityDate: string): Promise<AnalyticsRollupResult> {
  assertActivityDate(activityDate);
  const client = await pool.connect();
  let lockAcquired = false;

  try {
    lockAcquired = await tryAcquireRollupLock(client);
    if (!lockAcquired) return { processedDates: [], retentionDeleted: 0, skipped: true };

    await finalizeInactiveReaderSessions(client);

    await client.query("begin");
    try {
      await client.query("delete from analytics_rollup_queue where activity_date = $1::date", [activityDate]);
      await rebuildAnalyticsDay(client, activityDate);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }

    return {
      processedDates: [activityDate],
      retentionDeleted: await deleteExpiredRawEvents(client),
      skipped: false,
    };
  } finally {
    try {
      if (lockAcquired) await releaseRollupLock(client);
    } finally {
      client.release();
    }
  }
}

export async function rollupPendingAnalyticsDays(batchSize = DEFAULT_BATCH_SIZE): Promise<AnalyticsRollupResult> {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 366) {
    throw new Error("Размер пакета аналитики должен быть целым числом от 1 до 366");
  }

  const client = await pool.connect();
  let lockAcquired = false;

  try {
    lockAcquired = await tryAcquireRollupLock(client);
    if (!lockAcquired) return { processedDates: [], retentionDeleted: 0, skipped: true };

    await finalizeInactiveReaderSessions(client);

    const pending = await client.query<ActivityDateRow>(
      `
        select activity_date::text as "activityDate"
        from analytics_rollup_queue
        where activity_date < (now() at time zone 'UTC')::date
        order by activity_date asc
        limit $1
      `,
      [batchSize],
    );

    const processedDates: string[] = [];
    for (const { activityDate } of pending.rows) {
      if (await rebuildQueuedDay(client, activityDate)) processedDates.push(activityDate);
    }

    return {
      processedDates,
      retentionDeleted: await deleteExpiredRawEvents(client),
      skipped: false,
    };
  } finally {
    try {
      if (lockAcquired) await releaseRollupLock(client);
    } finally {
      client.release();
    }
  }
}
