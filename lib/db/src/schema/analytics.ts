import { bigint, check, date, index, integer, jsonb, pgTable, primaryKey, smallint, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { booksTable } from "./books";
import { usersTable } from "./users";

export const analyticsEventsTable = pgTable(
  "analytics_events",
  {
    eventId: uuid("event_id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    bookId: integer("book_id").references(() => booksTable.id, { onDelete: "cascade" }),
    eventName: text("event_name").notNull(),
    producer: text("producer").notNull(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    occurredLocalDate: date("occurred_local_date").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    clientId: uuid("client_id"),
    sessionId: uuid("session_id"),
    platform: text("platform").notNull(),
    deviceMode: text("device_mode").notNull().default("unknown"),
    appVersion: varchar("app_version", { length: 64 }),
    properties: jsonb("properties").notNull().default({}),
  },
  (t) => [
    check("analytics_events_producer_check", sql`${t.producer} in ('client', 'server')`),
    check("analytics_events_platform_check", sql`${t.platform} = 'web'`),
    check("analytics_events_device_mode_check", sql`${t.deviceMode} in ('desktop', 'mobile', 'unknown')`),
    check("analytics_events_properties_object", sql`jsonb_typeof(${t.properties}) = 'object'`),
    index("analytics_events_user_date_idx").on(t.userId, t.occurredLocalDate),
    index("analytics_events_name_time_idx").on(t.eventName, t.occurredAt),
    index("analytics_events_book_time_idx").on(t.bookId, t.occurredAt).where(sql`${t.bookId} is not null`),
    index("analytics_reading_progress_idx").on(t.bookId, t.userId, t.occurredAt).where(sql`${t.eventName} = 'reading_progressed'`),
  ],
);

export const analyticsDailyUserActivityTable = pgTable(
  "analytics_daily_user_activity",
  {
    activityDate: date("activity_date").notNull(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    deviceMode: text("device_mode").notNull(),
    appOpens: integer("app_opens").notNull().default(0),
    readerSessions: integer("reader_sessions").notNull().default(0),
    activeReadingMs: bigint("active_reading_ms", { mode: "number" }).notNull().default(0),
    booksStarted: integer("books_started").notNull().default(0),
    booksCompleted: integer("books_completed").notNull().default(0),
    syncAttempts: integer("sync_attempts").notNull().default(0),
    syncSuccesses: integer("sync_successes").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.activityDate, t.userId, t.deviceMode] }),
    check("analytics_daily_user_device_mode_check", sql`${t.deviceMode} in ('desktop', 'mobile', 'unknown')`),
  ],
);

export const analyticsDailyBookActivityTable = pgTable(
  "analytics_daily_book_activity",
  {
    activityDate: date("activity_date").notNull(),
    bookId: integer("book_id").notNull().references(() => booksTable.id, { onDelete: "cascade" }),
    readers: integer("readers").notNull().default(0),
    readerSessions: integer("reader_sessions").notNull().default(0),
    activeReadingMs: bigint("active_reading_ms", { mode: "number" }).notNull().default(0),
    starts: integer("starts").notNull().default(0),
    completions: integer("completions").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.activityDate, t.bookId] })],
);

export const analyticsRollupQueueTable = pgTable("analytics_rollup_queue", {
  activityDate: date("activity_date").primaryKey(),
  queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
