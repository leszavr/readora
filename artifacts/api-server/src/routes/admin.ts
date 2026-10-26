import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import bcrypt from "bcryptjs";
import fs from "node:fs";
import os from "node:os";
import { statfs } from "node:fs/promises";
import {
  db,
  usersTable,
  booksTable,
  genresTable,
  readEventsTable,
  bookUploadJobsTable,
  appSettingsTable,
  MAINTENANCE_MODE_KEY,
  MAINTENANCE_REASON_KEY,
  MAINTENANCE_ETA_KEY,
  MAINTENANCE_MESSAGE_KEY,
  analyticsDailyBookActivityTable,
  analyticsDailyUserActivityTable,
  analyticsEventsTable,
  unverifiedAccountCleanupLogTable,
  readingProgressTable,
  giftEditionsTable,
  feedbackResponsesTable,
} from "@workspace/db";
import { requireAdmin, requireSystemAdmin } from "../middlewares/auth";
import { formatUser } from "./auth";
import { FEEDBACK_PAIN_POINTS } from "./feedback";
import {
  usersWithCompletedUploadsSql,
  usersWithFirstReadSql,
} from "../lib/analytics-marketing-sql";
import { emailService } from "../lib/email-service";
import { logger } from "../lib/logger";
import { deleteStoredFilesIfUnreferenced, normalizeBookIds } from "../lib/book-deletion-service";
import { resolveUploadPath } from "../lib/storage";
import { GIFT_SOURCE_IN_USE_MESSAGE, hasGiftCopiesOutside, userOwnsGiftSourcesInUse } from "../lib/gift-editions-service";
import { getMaintenanceStatus } from "../lib/maintenance-status";
import { isRegistrationEnabled } from "../lib/registration-status";
import {
  DEFAULT_LIBRARY_STORAGE_MB,
  DEFAULT_MAX_BOOK_FILE_SIZE_MB,
  quotaSettingBounds,
  validateQuotaSetting,
} from "../lib/storage-quota";

const router = Router();
const PWA_INSTALL_ACCEPTED_KEY = "pwa_install_accepted_count";

// GET /admin/system-metrics
router.get(
  "/admin/system-metrics",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const cpuCores = os.cpus().length;
    const [load1m, load5m, load15m] = os.loadavg();

    const memoryTotalBytes = os.totalmem();
    const memoryFreeBytes = os.freemem();
    const memoryUsedBytes = memoryTotalBytes - memoryFreeBytes;

    const diskPath = process.env.UPLOADS_DIR ?? "/";

    let diskTotalBytes = 0;
    let diskFreeBytes = 0;
    let diskUsedBytes = 0;

    try {
      const fsStats = await statfs(diskPath);
      diskTotalBytes = fsStats.blocks * fsStats.bsize;
      diskFreeBytes = fsStats.bavail * fsStats.bsize;
      diskUsedBytes = diskTotalBytes - diskFreeBytes;
    } catch (error) {
      logger.warn({ error, diskPath }, "Failed to read filesystem stats");
    }

    res.json({
      cpuCores,
      loadAvg1m: load1m,
      loadAvg5m: load5m,
      loadAvg15m: load15m,
      memoryTotalBytes,
      memoryFreeBytes,
      memoryUsedBytes,
      diskPath,
      diskTotalBytes,
      diskFreeBytes,
      diskUsedBytes,
      processUptimeSec: process.uptime(),
      systemUptimeSec: os.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      timestamp: new Date().toISOString(),
    });
  },
);

// GET /admin/stats
router.get("/admin/stats", requireAdmin, async (_req, res): Promise<void> => {
  const [{ totalUsers }] = await db
    .select({ totalUsers: sql<number>`count(*)::int` })
    .from(usersTable);
  const [{ totalBooks }] = await db
    .select({ totalBooks: sql<number>`count(*)::int` })
    .from(booksTable);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [{ progressSaves7d }] = await db
    .select({ progressSaves7d: sql<number>`count(*)::int` })
    .from(readEventsTable)
    .where(sql`${readEventsTable.createdAt} > ${sevenDaysAgo} and ${readEventsTable.eventType} = 'progress_saved'`);

  const [{ activeReaders }] = await db
    .select({
      activeReaders: sql<number>`count(distinct ${readEventsTable.userId})::int`,
    })
    .from(readEventsTable)
    .where(sql`${readEventsTable.createdAt} > ${sevenDaysAgo} and ${readEventsTable.eventType} = 'progress_saved'`);

  const recentBooksRaw = await db
    .select()
    .from(booksTable)
    .orderBy(desc(booksTable.uploadedAt))
    .limit(5);
  const recentUsersRaw = await db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt))
    .limit(5);

  const recentBooks = recentBooksRaw.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author ?? null,
    format: b.format,
    status: b.status,
    ownerUsername: null,
    ownerId: b.ownerUserId,
    fileSize: b.fileSize,
    uploadedAt: b.uploadedAt,
  }));

  const recentUsers = recentUsersRaw.map(formatUser);

  res.json({
    totalUsers,
    totalBooks,
    activeReaders,
    progressSaves7d,
    recentBooks,
    recentUsers,
  });
});

// GET /admin/analytics?days=7|30|90
router.get("/admin/analytics", requireSystemAdmin, async (req, res): Promise<void> => {
  const requestedDays = req.query.days;
  const days = requestedDays === undefined ? 30 : ({ "7": 7, "30": 30, "90": 90 } as const)[
    typeof requestedDays === "string" ? requestedDays : ""
  ];
  if (days === undefined) {
    res.status(400).json({ error: "Период должен быть равен 7, 30 или 90 дням" });
    return;
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const rangeEnd = end.toISOString().slice(0, 10);
  end.setUTCDate(end.getUTCDate() - days + 1);
  const rangeStart = end.toISOString().slice(0, 10);
  const currentDay = new Date().toISOString().slice(0, 10);

  const inRange = sql`${analyticsDailyUserActivityTable.activityDate} >= ${rangeStart}::date and ${analyticsDailyUserActivityTable.activityDate} <= ${rangeEnd}::date`;
  const bookInRange = sql`${analyticsDailyBookActivityTable.activityDate} >= ${rangeStart}::date and ${analyticsDailyBookActivityTable.activityDate} <= ${rangeEnd}::date`;

  const [summaryRows, trend, bookSummaryRows, totalUserRows, totalBookRows, readingRows, pwaRows, marketingRows, registrationTrend, referralSources, retentionRows, completionRows, sessionRows, engagementRows, deviceRows, currentDayRows, unverifiedCleanupRows] = await Promise.all([
    db
      .select({
        activeUsers: sql<number>`count(distinct ${analyticsDailyUserActivityTable.userId})::int`,
        appOpens: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.appOpens}), 0)::double precision`,
        readerSessions: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.readerSessions}), 0)::double precision`,
        activeReadingMs: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.activeReadingMs}), 0)::double precision`,
        booksStarted: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.booksStarted}), 0)::double precision`,
        booksCompleted: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.booksCompleted}), 0)::double precision`,
        syncAttempts: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.syncAttempts}), 0)::double precision`,
        syncSuccesses: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.syncSuccesses}), 0)::double precision`,
      })
      .from(analyticsDailyUserActivityTable)
      .where(inRange),
    db
      .select({
        activityDate: analyticsDailyUserActivityTable.activityDate,
        activeUsers: sql<number>`count(distinct ${analyticsDailyUserActivityTable.userId})::int`,
        appOpens: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.appOpens}), 0)::double precision`,
        readerSessions: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.readerSessions}), 0)::double precision`,
        activeReadingMs: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.activeReadingMs}), 0)::double precision`,
        booksCompleted: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.booksCompleted}), 0)::double precision`,
        syncAttempts: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.syncAttempts}), 0)::double precision`,
        syncSuccesses: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.syncSuccesses}), 0)::double precision`,
      })
      .from(analyticsDailyUserActivityTable)
      .where(inRange)
      .groupBy(analyticsDailyUserActivityTable.activityDate)
      .orderBy(asc(analyticsDailyUserActivityTable.activityDate)),
    db
      .select({
        trackedBooks: sql<number>`count(distinct ${analyticsDailyBookActivityTable.bookId})::int`,
      })
      .from(analyticsDailyBookActivityTable)
      .where(bookInRange),
    db
      .select({ totalUsers: sql<number>`count(*)::int` })
      .from(usersTable),
    db
      .select({ totalBooks: sql<number>`count(*)::int` })
      .from(booksTable),
    db
      .select({
        activeReaders: sql<number>`count(distinct ${readEventsTable.userId})::int`,
        progressSaves: sql<number>`count(*)::int`,
      })
      .from(readEventsTable)
      .where(sql`${readEventsTable.createdAt} >= ${rangeStart}::date and ${readEventsTable.createdAt} < (${rangeEnd}::date + interval '1 day') and ${readEventsTable.eventType} = 'progress_saved'`),
    db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, PWA_INSTALL_ACCEPTED_KEY))
      .limit(1),
    db
      .select({
        registrations: sql<number>`count(*)::int`,
        verifiedUsers: sql<number>`count(*) filter (where ${usersTable.emailVerifiedAt} is not null)::int`,
        firstSuccessfulUploads: usersWithCompletedUploadsSql,
        usersWithFirstRead: usersWithFirstReadSql,
      })
      .from(usersTable)
      .where(sql`${usersTable.createdAt} >= ${rangeStart}::date and ${usersTable.createdAt} < (${rangeEnd}::date + interval '1 day')`),
    db
      .select({
        weekStart: sql<string>`date_trunc('week', ${usersTable.createdAt} at time zone 'UTC')::date::text`,
        registrations: sql<number>`count(*)::int`,
      })
      .from(usersTable)
      .where(sql`${usersTable.createdAt} >= date_trunc('week', now() at time zone 'UTC') - interval '7 weeks'`)
      .groupBy(sql`date_trunc('week', ${usersTable.createdAt} at time zone 'UTC')::date`)
      .orderBy(sql`date_trunc('week', ${usersTable.createdAt} at time zone 'UTC')::date asc`),
    db
      .select({
        source: sql<string>`coalesce(${usersTable.referralSource}, 'unknown')`,
        registrations: sql<number>`count(*)::int`,
      })
      .from(usersTable)
      .where(sql`${usersTable.createdAt} >= ${rangeStart}::date and ${usersTable.createdAt} < (${rangeEnd}::date + interval '1 day')`)
      .groupBy(sql`coalesce(${usersTable.referralSource}, 'unknown')`)
      .orderBy(sql`count(*) desc`, sql`coalesce(${usersTable.referralSource}, 'unknown') asc`)
      .limit(5),
    db.execute(sql`
      select
        count(*) filter (
          where registered_at <= current_utc_date - 7
            and exists (
              select 1 from read_events as day_zero_event
              where day_zero_event.user_id = cohort_user.id
                and day_zero_event.event_type = 'progress_saved'
                and (day_zero_event.created_at at time zone 'UTC')::date = registered_at
            )
        )::int as "d7EligibleUsers",
        count(*) filter (
          where registered_at <= current_utc_date - 7
            and exists (
              select 1 from read_events as day_zero_event
              where day_zero_event.user_id = cohort_user.id
                and day_zero_event.event_type = 'progress_saved'
                and (day_zero_event.created_at at time zone 'UTC')::date = registered_at
            )
            and exists (
              select 1 from read_events as return_event
              where return_event.user_id = cohort_user.id
                and return_event.event_type = 'progress_saved'
                and (return_event.created_at at time zone 'UTC')::date = registered_at + 7
            )
        )::int as "d7RetainedUsers",
        count(*) filter (
          where registered_at <= current_utc_date - 30
            and exists (
              select 1 from read_events as day_zero_event
              where day_zero_event.user_id = cohort_user.id
                and day_zero_event.event_type = 'progress_saved'
                and (day_zero_event.created_at at time zone 'UTC')::date = registered_at
            )
        )::int as "d30EligibleUsers",
        count(*) filter (
          where registered_at <= current_utc_date - 30
            and exists (
              select 1 from read_events as day_zero_event
              where day_zero_event.user_id = cohort_user.id
                and day_zero_event.event_type = 'progress_saved'
                and (day_zero_event.created_at at time zone 'UTC')::date = registered_at
            )
            and exists (
              select 1 from read_events as return_event
              where return_event.user_id = cohort_user.id
                and return_event.event_type = 'progress_saved'
                and (return_event.created_at at time zone 'UTC')::date = registered_at + 30
            )
        )::int as "d30RetainedUsers"
      from (
        select id, (created_at at time zone 'UTC')::date as registered_at,
          (now() at time zone 'UTC')::date as current_utc_date
        from users
      ) as cohort_user
    `),
    db
      .select({ completedBooks: sql<number>`count(distinct ${readingProgressTable.bookId}) filter (where ${readingProgressTable.completedAt} is not null)::int` })
      .from(readingProgressTable),
    db.execute(sql`
      select
        count(*)::int as sessions,
        coalesce(min((properties->>'activeReadingMs')::bigint), 0)::bigint as "minMs",
        coalesce(max((properties->>'activeReadingMs')::bigint), 0)::bigint as "maxMs",
        coalesce(round(avg((properties->>'activeReadingMs')::bigint)), 0)::bigint as "avgMs",
        count(*) filter (where (properties->>'activeReadingMs')::bigint < 30000)::int as "shortSessions",
        count(*) filter (where properties->>'endReason' = 'hidden')::int as "hiddenEnds",
        count(*) filter (where properties->>'endReason' = 'inactive')::int as "inactiveEnds",
        count(*) filter (where properties->>'endReason' = 'unmount')::int as "unmountEnds",
        count(*) filter (where properties->>'endReason' = 'timeout')::int as "timeoutEnds"
      from ${analyticsEventsTable}
      where ${analyticsEventsTable.eventName} = 'reader_session_ended'
        and ${analyticsEventsTable.eventDay} >= ${rangeStart}::date
        and ${analyticsEventsTable.eventDay} <= ${rangeEnd}::date
    `),
    db.execute(sql`
      select
        count(distinct ${analyticsDailyUserActivityTable.userId}) filter (
          where ${analyticsDailyUserActivityTable.activityDate} = ${rangeEnd}::date
        )::int as "dau",
        count(distinct ${analyticsDailyUserActivityTable.userId}) filter (
          where ${analyticsDailyUserActivityTable.activityDate} >= ${rangeEnd}::date - 6
        )::int as "wau",
        count(distinct ${analyticsDailyUserActivityTable.userId}) filter (
          where ${analyticsDailyUserActivityTable.activityDate} >= ${rangeEnd}::date - 29
        )::int as "mau"
      from ${analyticsDailyUserActivityTable}
      where ${analyticsDailyUserActivityTable.activityDate} <= ${rangeEnd}::date
        and ${analyticsDailyUserActivityTable.activityDate} >= ${rangeEnd}::date - 29
    `),
    db
      .select({
        deviceMode: analyticsDailyUserActivityTable.deviceMode,
        users: sql<number>`count(distinct ${analyticsDailyUserActivityTable.userId})::int`,
        appOpens: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.appOpens}), 0)::int`,
        readerSessions: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.readerSessions}), 0)::int`,
        activeReadingMs: sql<number>`coalesce(sum(${analyticsDailyUserActivityTable.activeReadingMs}), 0)::bigint`,
      })
      .from(analyticsDailyUserActivityTable)
      .where(inRange)
      .groupBy(analyticsDailyUserActivityTable.deviceMode)
      .orderBy(desc(sql`coalesce(sum(${analyticsDailyUserActivityTable.activeReadingMs}), 0)`)),
    db.execute(sql`
      select
        count(distinct user_id)::int as "activeUsers",
        count(*) filter (where event_name = 'app_opened')::int as "appOpens",
        count(*) filter (where event_name = 'reader_session_ended')::int as "readerSessions",
        coalesce(sum((properties->>'activeReadingMs')::bigint) filter (where event_name = 'reader_session_ended'), 0)::bigint as "activeReadingMs",
        count(*) filter (where event_name = 'reader_session_started' and coalesce((properties->>'startProgressPct')::numeric, 0) = 0)::int as "booksStarted",
        count(*) filter (where event_name = 'book_completed')::int as "booksCompleted",
        count(*) filter (where event_name = 'progress_sync_finished')::int as "syncAttempts",
        count(*) filter (where event_name = 'progress_sync_finished' and properties->>'outcome' = 'success')::int as "syncSuccesses"
      from ${analyticsEventsTable}
      where ${analyticsEventsTable.eventDay} = ${currentDay}::date
    `),
    db
      .select({
        action: unverifiedAccountCleanupLogTable.action,
        count: sql<number>`count(*)::int`,
      })
      .from(unverifiedAccountCleanupLogTable)
      .where(sql`${unverifiedAccountCleanupLogTable.createdAt} >= ${rangeStart}::date and ${unverifiedAccountCleanupLogTable.createdAt} < (${rangeEnd}::date + interval '1 day')`)
      .groupBy(unverifiedAccountCleanupLogTable.action),
  ]);

  const summary = summaryRows[0];
  const marketing = marketingRows[0];
  const retention = retentionRows.rows[0] as {
    d7EligibleUsers: number;
    d7RetainedUsers: number;
    d30EligibleUsers: number;
    d30RetainedUsers: number;
  } | undefined ?? {
    d7EligibleUsers: 0,
    d7RetainedUsers: 0,
    d30EligibleUsers: 0,
    d30RetainedUsers: 0,
  };
  const pwaInstallAccepted = Number.parseInt(pwaRows[0]?.value ?? "0", 10);
  const syncSuccessRate = summary.syncAttempts === 0
    ? 0
    : Number(((summary.syncSuccesses / summary.syncAttempts) * 100).toFixed(1));
  const toRate = (numerator: number, denominator: number): number => denominator === 0 ? 0 : Number(((numerator / denominator) * 100).toFixed(1));
  const toRatio = (numerator: number, denominator: number): number => denominator === 0 ? 0 : Number((numerator / denominator).toFixed(1));
  const completedBooks = completionRows[0].completedBooks;
  const sessionStats = (sessionRows.rows[0] ?? {
    sessions: 0,
    minMs: 0,
    maxMs: 0,
    avgMs: 0,
    shortSessions: 0,
    hiddenEnds: 0,
    inactiveEnds: 0,
    unmountEnds: 0,
    timeoutEnds: 0,
  }) as {
    sessions: number;
    minMs: number;
    maxMs: number;
    avgMs: number;
    shortSessions: number;
    hiddenEnds: number;
    inactiveEnds: number;
    unmountEnds: number;
    timeoutEnds: number;
  };
  const sessions = {
    count: Number(sessionStats.sessions),
    minMs: Number(sessionStats.minMs),
    avgMs: Number(sessionStats.avgMs),
    maxMs: Number(sessionStats.maxMs),
    shortSessions: Number(sessionStats.shortSessions),
    shortShare: toRate(Number(sessionStats.shortSessions), Number(sessionStats.sessions)),
    byEndReason: [
      { reason: "hidden", count: Number(sessionStats.hiddenEnds) },
      { reason: "inactive", count: Number(sessionStats.inactiveEnds) },
      { reason: "unmount", count: Number(sessionStats.unmountEnds) },
      { reason: "timeout", count: Number(sessionStats.timeoutEnds) },
    ],
  };
  const devices = deviceRows.map((row) => ({
    deviceMode: row.deviceMode,
    users: Number(row.users),
    appOpens: Number(row.appOpens),
    readerSessions: Number(row.readerSessions),
    activeReadingMs: Number(row.activeReadingMs),
  }));
  const engagementRaw = (engagementRows.rows[0] ?? { dau: 0, wau: 0, mau: 0 }) as {
    dau: number;
    wau: number;
    mau: number;
  };
  const engagement = {
    dau: Number(engagementRaw.dau),
    wau: Number(engagementRaw.wau),
    mau: Number(engagementRaw.mau),
    stickiness: toRate(Number(engagementRaw.dau), Number(engagementRaw.mau)),
  };
  const currentDayRaw = (currentDayRows.rows[0] ?? {
    activeUsers: 0,
    appOpens: 0,
    readerSessions: 0,
    activeReadingMs: 0,
    booksStarted: 0,
    booksCompleted: 0,
    syncAttempts: 0,
    syncSuccesses: 0,
  }) as Record<string, number | string>;
  const unverifiedAccounts = {
    remindersSent: unverifiedCleanupRows.find((row) => row.action === "reminder_sent")?.count ?? 0,
    accountsDeleted: unverifiedCleanupRows.find((row) => row.action === "account_deleted")?.count ?? 0,
  };
  const provisionalCurrentDay = {
    activityDate: currentDay,
    activeUsers: Number(currentDayRaw.activeUsers),
    appOpens: Number(currentDayRaw.appOpens),
    readerSessions: Number(currentDayRaw.readerSessions),
    activeReadingMs: Number(currentDayRaw.activeReadingMs),
    booksStarted: Number(currentDayRaw.booksStarted),
    booksCompleted: Number(currentDayRaw.booksCompleted),
    syncAttempts: Number(currentDayRaw.syncAttempts),
    syncSuccesses: Number(currentDayRaw.syncSuccesses),
  };

  res.json({
    days,
    rangeStart,
    rangeEnd,
    systemSummary: {
      totalUsers: totalUserRows[0].totalUsers,
      totalBooks: totalBookRows[0].totalBooks,
      activeReaders: readingRows[0].activeReaders,
      progressSaves: readingRows[0].progressSaves,
      pwaInstallConfirmations: Number.isFinite(pwaInstallAccepted) ? pwaInstallAccepted : 0,
      booksPerUser: toRatio(totalBookRows[0].totalBooks, totalUserRows[0].totalUsers),
      progressSavesPerReader: toRatio(readingRows[0].progressSaves, readingRows[0].activeReaders),
      completedBooks,
      completedBooksRate: toRate(completedBooks, totalBookRows[0].totalBooks),
    },
    summary: {
      ...summary,
      syncSuccessRate,
      trackedBooks: bookSummaryRows[0].trackedBooks,
      averageSessionReadingMs: summary.readerSessions === 0 ? 0 : Math.round(summary.activeReadingMs / summary.readerSessions),
    },
    sessions,
    engagement,
    devices,
    unverifiedAccounts,
    marketing: {
      registrations: marketing.registrations,
      verifiedUsers: marketing.verifiedUsers,
      emailVerificationRate: toRate(marketing.verifiedUsers, marketing.registrations),
      firstSuccessfulUploads: marketing.firstSuccessfulUploads,
      firstSuccessfulUploadRate: toRate(marketing.firstSuccessfulUploads, marketing.registrations),
      usersWithFirstRead: marketing.usersWithFirstRead,
      firstReadRate: toRate(marketing.usersWithFirstRead, marketing.registrations),
      funnel: [
        { step: "registered", label: "Регистрация", count: marketing.registrations },
        { step: "upload_completed", label: "Первая успешная загрузка", count: marketing.firstSuccessfulUploads },
        { step: "first_read", label: "Первое чтение", count: marketing.usersWithFirstRead },
      ],
      retention: {
        d7EligibleUsers: retention.d7EligibleUsers,
        d7RetainedUsers: retention.d7RetainedUsers,
        d7Rate: toRate(retention.d7RetainedUsers, retention.d7EligibleUsers),
        d30EligibleUsers: retention.d30EligibleUsers,
        d30RetainedUsers: retention.d30RetainedUsers,
        d30Rate: toRate(retention.d30RetainedUsers, retention.d30EligibleUsers),
      },
      registrationTrend,
      referralSources,
    },
    trend,
    provisionalCurrentDay,
  });
});

// GET /admin/analytics/users?days=7|30|90 - детализация по пользователям (system admin only)
router.get("/admin/analytics/users", requireSystemAdmin, async (req, res): Promise<void> => {
  const requestedDays = req.query.days;
  const days = requestedDays === undefined ? 30 : ({ "7": 7, "30": 30, "90": 90 } as const)[
    typeof requestedDays === "string" ? requestedDays : ""
  ];
  if (days === undefined) {
    res.status(400).json({ error: "Период должен быть равен 7, 30 или 90 дням" });
    return;
  }

  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 1);
  const rangeEnd = end.toISOString().slice(0, 10);
  end.setUTCDate(end.getUTCDate() - days + 1);
  const rangeStart = end.toISOString().slice(0, 10);

  const result = await db.execute(sql`
    select
      activity.user_id::int as "userId",
      users.username,
      users.role,
      count(distinct activity.activity_date)::int as "activeDays",
      coalesce(sum(activity.app_opens), 0)::int as "appOpens",
      coalesce(sum(activity.reader_sessions), 0)::int as "readerSessions",
      coalesce(sum(activity.active_reading_ms), 0)::bigint as "activeReadingMs",
      coalesce(sum(activity.books_started), 0)::int as "booksStarted",
      coalesce(sum(activity.books_completed), 0)::int as "booksCompleted",
      coalesce(sum(activity.sync_attempts), 0)::int as "syncAttempts",
      coalesce(sum(activity.sync_successes), 0)::int as "syncSuccesses",
      max(activity.activity_date)::text as "lastActiveDate",
      coalesce(session_stats.sessions, 0)::int as "sessionCount",
      coalesce(session_stats.min_ms, 0)::bigint as "minSessionMs",
      coalesce(session_stats.avg_ms, 0)::bigint as "avgSessionMs",
      coalesce(session_stats.max_ms, 0)::bigint as "maxSessionMs"
    from analytics_daily_user_activity as activity
    join users on users.id = activity.user_id
    left join (
      select
        user_id,
        count(*)::int as sessions,
        coalesce(min((properties->>'activeReadingMs')::bigint), 0) as min_ms,
        coalesce(round(avg((properties->>'activeReadingMs')::bigint)), 0) as avg_ms,
        coalesce(max((properties->>'activeReadingMs')::bigint), 0) as max_ms
      from ${analyticsEventsTable}
      where event_name = 'reader_session_ended'
        and event_day >= ${rangeStart}::date
        and event_day <= ${rangeEnd}::date
      group by user_id
    ) as session_stats on session_stats.user_id = activity.user_id
    where activity.activity_date >= ${rangeStart}::date and activity.activity_date <= ${rangeEnd}::date
    group by activity.user_id, users.username, users.role, session_stats.sessions, session_stats.min_ms, session_stats.avg_ms, session_stats.max_ms
    order by "activeReadingMs" desc
    limit 200
  `);

  const items = (result.rows as Array<Record<string, unknown>>).map((row) => ({
    userId: Number(row.userId),
    username: row.username as string,
    role: row.role as string,
    activeDays: Number(row.activeDays),
    appOpens: Number(row.appOpens),
    readerSessions: Number(row.readerSessions),
    activeReadingMs: Number(row.activeReadingMs),
    booksStarted: Number(row.booksStarted),
    booksCompleted: Number(row.booksCompleted),
    syncAttempts: Number(row.syncAttempts),
    syncSuccesses: Number(row.syncSuccesses),
    lastActiveDate: row.lastActiveDate as string,
    sessionCount: Number(row.sessionCount),
    minSessionMs: Number(row.minSessionMs),
    avgSessionMs: Number(row.avgSessionMs),
    maxSessionMs: Number(row.maxSessionMs),
  }));

  res.json({ days, rangeStart, rangeEnd, items });
});

// GET /admin/users
router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const { search, role, status } = req.query as Record<string, string>;
  const users = await db
    .select()
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));

  let result = users;
  if (search)
    result = result.filter(
      (u) =>
        u.email.includes(search) ||
        u.username.toLowerCase().includes(search.toLowerCase()),
    );
  if (role) result = result.filter((u) => u.role === role);
  if (status) result = result.filter((u) => u.status === status);

  const withCounts = await Promise.all(
    result.map(async (u) => {
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(booksTable)
        .where(eq(booksTable.ownerUserId, u.id));
      return { ...formatUser(u), bookCount: count };
    }),
  );

  res.json(withCounts);
});

// POST /admin/users
router.post("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const { email, password, username, role } = req.body ?? {};
  if (!email || !password || !username) {
    res.status(400).json({ error: "Все поля обязательны" });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      username,
      passwordHash,
      role: role ?? "user",
      emailVerified: true,
      emailVerifiedAt: new Date(),
      analyticsOptIn: true,
    })
    .returning();
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(booksTable)
    .where(eq(booksTable.ownerUserId, user.id));
  res.status(201).json({ ...formatUser(user), bookCount: count });
});

// GET /admin/users/:id
router.get(
  "/admin/users/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!user) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(booksTable)
      .where(eq(booksTable.ownerUserId, id));
    res.json({ ...formatUser(user), bookCount: count });
  },
);

// PATCH /admin/users/:id
router.patch(
  "/admin/users/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const { username, email, role, status } = req.body ?? {};
    const updates: Partial<typeof usersTable.$inferSelect> = {};
    if (username != null) updates.username = username;
    if (email != null) updates.email = email;
    if (role != null) updates.role = role;
    if (status != null) updates.status = status;
    const [user] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, id))
      .returning();
    if (!user) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(booksTable)
      .where(eq(booksTable.ownerUserId, id));
    res.json({ ...formatUser(user), bookCount: count });
  },
);
// POST /admin/users/:id/verify-email - Force email verification by admin
router.post(
  "/admin/users/:id/verify-email",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!user) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    if (user.emailVerified) {
      res.status(400).json({ error: "Email уже подтвержден" });
      return;
    }

    await db
      .update(usersTable)
      .set({ emailVerified: true, emailVerifiedAt: new Date() })
      .where(eq(usersTable.id, id));
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(booksTable)
      .where(eq(booksTable.ownerUserId, id));
    const [updated] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    res.json({ ...formatUser(updated!), bookCount: count });
  },
);
// POST /admin/users/:id/password
router.post(
  "/admin/users/:id/password",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) {
      res
        .status(400)
        .json({ error: "Некорректный идентификатор пользователя" });
      return;
    }

    const passwordSchema = {
      newPassword:
        typeof req.body?.newPassword === "string" ? req.body.newPassword : "",
    };

    if (passwordSchema.newPassword.length < 8) {
      res
        .status(400)
        .json({ error: "Новый пароль должен быть не короче 8 символов" });
      return;
    }

    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }

    const passwordHash = await bcrypt.hash(passwordSchema.newPassword, 12);
    await db
      .update(usersTable)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, id));

    res.json({ message: "Пароль пользователя обновлен" });
  },
);

// DELETE /admin/users/:id
router.delete(
  "/admin/users/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (await userOwnsGiftSourcesInUse(id)) {
      res.status(409).json({ error: "У пользователя есть книги, выданные как подарочные издания. Сначала передайте или снимите их с публикации." });
      return;
    }
    await db.delete(usersTable).where(eq(usersTable.id, id));
    res.sendStatus(204);
  },
);

// POST /admin/users/:id/toggle-block
router.post(
  "/admin/users/:id/toggle-block",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!user) {
      res.status(404).json({ error: "Пользователь не найден" });
      return;
    }
    const newStatus = user.status === "active" ? "blocked" : "active";
    const [updated] = await db
      .update(usersTable)
      .set({ status: newStatus })
      .where(eq(usersTable.id, id))
      .returning();
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(booksTable)
      .where(eq(booksTable.ownerUserId, id));
    res.json({ ...formatUser(updated), bookCount: count });
  },
);

// GET /admin/books
router.get("/admin/books", requireAdmin, async (req, res): Promise<void> => {
  const { search } = req.query as Record<string, string>;
  // Подарочные копии пользователей не показываем: это не загрузки, а ссылки на эталон.
  const giftEditionId = sql<number | null>`(
    select ge.id from ${giftEditionsTable} ge join ${booksTable} src on src.id = ge.book_id
    where src.id = ${booksTable.id} or (src.file_hash is not null and src.file_hash = ${booksTable.fileHash})
    order by (src.id = ${booksTable.id}) desc limit 1
  )`;
  const books = await db
    .select({ book: booksTable, username: usersTable.username, giftEditionId })
    .from(booksTable)
    .leftJoin(usersTable, eq(booksTable.ownerUserId, usersTable.id))
    .where(isNull(booksTable.contentBookId))
    .orderBy(desc(booksTable.uploadedAt));

  let result = books;
  if (search)
    result = result.filter(
      (r) =>
        r.book.title.toLowerCase().includes(search.toLowerCase()) ||
        (r.book.author ?? "").toLowerCase().includes(search.toLowerCase()),
    );

  res.json(
    result.map((r) => ({
      id: r.book.id,
      title: r.book.title,
      author: r.book.author ?? null,
      format: r.book.format,
      status: r.book.status,
      ownerUsername: r.username ?? null,
      ownerId: r.book.ownerUserId,
      fileSize: r.book.fileSize,
      uploadedAt: r.book.uploadedAt,
      giftEditionId: r.giftEditionId ?? null,
    })),
  );
});

// GET /admin/books/:id
router.get(
  "/admin/books/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const [result] = await db
      .select({ book: booksTable, username: usersTable.username })
      .from(booksTable)
      .leftJoin(usersTable, eq(booksTable.ownerUserId, usersTable.id))
      .where(eq(booksTable.id, id));
    if (!result) {
      res.status(404).json({ error: "Книга не найдена" });
      return;
    }
    res.json({
      id: result.book.id,
      title: result.book.title,
      author: result.book.author ?? null,
      format: result.book.format,
      status: result.book.status,
      ownerUsername: result.username ?? null,
      ownerId: result.book.ownerUserId,
      fileSize: result.book.fileSize,
      uploadedAt: result.book.uploadedAt,
    });
  },
);

// GET /admin/books/:id/download — скачать исходный файл книги (для проверки парсинга)
router.get(
  "/admin/books/:id/download",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const [book] = await db.select().from(booksTable).where(eq(booksTable.id, id));
    if (!book) {
      res.status(404).json({ error: "Книга не найдена" });
      return;
    }
    let filePath: string;
    try {
      filePath = resolveUploadPath(book.storageKey);
    } catch {
      res.status(500).json({ error: "Некорректный storage key" });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Файл книги не найден в хранилище" });
      return;
    }
    const safeTitle = (book.title ?? "").replace(/[\\/:*?"<>|\r\n]+/g, " ").trim() || `book-${book.id}`;
    const utf8Name = encodeURIComponent(`${safeTitle}.${book.format}`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="book-${book.id}.${book.format}"; filename*=UTF-8''${utf8Name}`,
    );
    fs.createReadStream(filePath).pipe(res);
  },
);

// DELETE /admin/books/:id
router.delete(
  "/admin/books/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const [book] = await db.select().from(booksTable).where(eq(booksTable.id, id));
    if (!book) {
      res.status(404).json({ error: "Книга не найдена" });
      return;
    }
    if (await hasGiftCopiesOutside([book.id])) {
      res.status(409).json({ error: GIFT_SOURCE_IN_USE_MESSAGE });
      return;
    }
    await deleteStoredFilesIfUnreferenced(book);
    await db.delete(booksTable).where(eq(booksTable.id, id));
    res.sendStatus(204);
  },
);

// POST /admin/books/delete-bulk
router.post("/admin/books/delete-bulk", requireAdmin, async (req, res): Promise<void> => {
  const ids = normalizeBookIds(req.body?.ids);
  if (!ids) {
    res.status(400).json({ error: "Передайте от 1 до 500 корректных ID книг" });
    return;
  }

  const booksToDelete = await db.select().from(booksTable).where(inArray(booksTable.id, ids));
  const deletingIds = booksToDelete.map((book) => book.id);
  if (deletingIds.length === 0) {
    res.json({ deleted: 0 });
    return;
  }
  if (await hasGiftCopiesOutside(deletingIds)) {
    res.status(409).json({ error: GIFT_SOURCE_IN_USE_MESSAGE });
    return;
  }
  for (const book of booksToDelete) {
    await deleteStoredFilesIfUnreferenced(book, deletingIds);
  }
  const deleted = await db.delete(booksTable).where(inArray(booksTable.id, deletingIds)).returning({ id: booksTable.id });
  res.json({ deleted: deleted.length });
});

// POST /admin/books/:id/toggle-block
router.post(
  "/admin/books/:id/toggle-block",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const [book] = await db
      .select()
      .from(booksTable)
      .where(eq(booksTable.id, id));
    if (!book) {
      res.status(404).json({ error: "Книга не найдена" });
      return;
    }
    const [updated] = await db
      .update(booksTable)
      .set({ status: book.status === "active" ? "blocked" : "active" })
      .where(eq(booksTable.id, id))
      .returning();
    const [owner] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, updated.ownerUserId));
    res.json({
      id: updated.id,
      title: updated.title,
      author: updated.author ?? null,
      format: updated.format,
      status: updated.status,
      ownerUsername: owner?.username ?? null,
      ownerId: updated.ownerUserId,
      fileSize: updated.fileSize,
      uploadedAt: updated.uploadedAt,
    });
  },
);

// GET /admin/settings
const SENSITIVE_KEYS = new Set(["smtp_password", "smtpPassword"]);

router.get(
  "/admin/settings",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const rows = await db.select().from(appSettingsTable);
    const map: Record<string, string | null> = {};
    for (const r of rows) {
      if (SENSITIVE_KEYS.has(r.key)) continue;
      map[r.key] = r.value;
    }
    res.json({
      // Полная карта настроек (snake_case, как хранится в БД, без паролей)
      ...map,
      // Алиасы для совместимости с AdminSettings.tsx (camelCase + типизация)
      siteName: map.siteName ?? "Readora",
      allowRegistration: map.allowRegistration !== "false",
      maxFileSizeMb: validateQuotaSetting(map.maxFileSizeMb ? Number(map.maxFileSizeMb) : undefined, quotaSettingBounds.maxBookFileSizeMb) ?? DEFAULT_MAX_BOOK_FILE_SIZE_MB,
      libraryStorageLimitMb: validateQuotaSetting(map.libraryStorageLimitMb ? Number(map.libraryStorageLimitMb) : undefined, quotaSettingBounds.libraryStorageMb) ?? DEFAULT_LIBRARY_STORAGE_MB,
      smtpHost: map.smtpHost ?? null,
      smtpPort: map.smtpPort ? Number.parseInt(map.smtpPort, 10) : null,
      smtpUser: map.smtpUser ?? null,
      smtpFrom: map.smtpFrom ?? null,
      appBaseUrl: map.app_base_url ?? null,
      feedbackEmail: map.feedbackEmail ?? null,
      maintenanceMode: map.maintenanceMode === "true",
      maintenanceReason: map.maintenanceReason ?? null,
      maintenanceEta: map.maintenanceEta ?? null,
      maintenanceMessage: map.maintenanceMessage ?? null,
      emailSaveToFiles: map.email_save_to_files === "true",
    });
  },
);

// PATCH /admin/settings
function normalizeSettingValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return JSON.stringify(value);
}

router.patch(
  "/admin/settings",
  requireAdmin,
  async (req, res): Promise<void> => {
    const updates = req.body ?? {};
    const maxFileSizeMb = updates.maxFileSizeMb === undefined
      ? undefined
      : validateQuotaSetting(updates.maxFileSizeMb, quotaSettingBounds.maxBookFileSizeMb);
    const libraryStorageLimitMb = updates.libraryStorageLimitMb === undefined
      ? undefined
      : validateQuotaSetting(updates.libraryStorageLimitMb, quotaSettingBounds.libraryStorageMb);
    if (
      (updates.maxFileSizeMb !== undefined && maxFileSizeMb === null) ||
      (updates.libraryStorageLimitMb !== undefined && libraryStorageLimitMb === null)
    ) {
      res.status(400).json({ error: "Лимиты должны быть целыми положительными числами в допустимом диапазоне" });
      return;
    }

    const currentQuotaRows = await db
      .select({ key: appSettingsTable.key, value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(inArray(appSettingsTable.key, ["maxFileSizeMb", "libraryStorageLimitMb"]));
    const currentQuota = Object.fromEntries(currentQuotaRows.map((row) => [row.key, row.value]));
    const effectiveMaxFileSizeMb = maxFileSizeMb ?? validateQuotaSetting(
      currentQuota.maxFileSizeMb ? Number(currentQuota.maxFileSizeMb) : undefined,
      quotaSettingBounds.maxBookFileSizeMb,
    ) ?? DEFAULT_MAX_BOOK_FILE_SIZE_MB;
    const effectiveLibraryStorageLimitMb = libraryStorageLimitMb ?? validateQuotaSetting(
      currentQuota.libraryStorageLimitMb ? Number(currentQuota.libraryStorageLimitMb) : undefined,
      quotaSettingBounds.libraryStorageMb,
    ) ?? DEFAULT_LIBRARY_STORAGE_MB;
    if (effectiveLibraryStorageLimitMb < effectiveMaxFileSizeMb) {
      res.status(400).json({ error: "Лимит библиотеки не может быть меньше максимального размера одной книги" });
      return;
    }
    let smtpTouched = false;

    for (const [key, value] of Object.entries(updates)) {
      const strVal = normalizeSettingValue(value);
      // Пароли: не затирать пустым значением (фронт не получает пароль при GET)
      if (SENSITIVE_KEYS.has(key) && (strVal === null || strVal.length === 0))
        continue;

      // camelCase -> snake_case для некоторых ключей
      let dbKey = key;
      if (key === "emailSaveToFiles") dbKey = "email_save_to_files";

      await db
        .insert(appSettingsTable)
        .values({ key: dbKey, value: strVal })
        .onConflictDoUpdate({
          target: appSettingsTable.key,
          set: { value: strVal },
        });
      if (
        key.startsWith("smtp_") ||
        key.startsWith("smtp") ||
        key === "emailSaveToFiles"
      )
        smtpTouched = true;
    }

    // Переинициализируем emailService, чтобы изменения вступили в силу без перезапуска
    if (smtpTouched) {
      await emailService.initialize().catch((err) => {
        console.error("[admin] emailService re-init failed:", err);
      });
    }
    // Return updated settings
    const rows = await db.select().from(appSettingsTable);
    const map: Record<string, string | null> = {};
    for (const r of rows) {
      if (SENSITIVE_KEYS.has(r.key)) continue;
      map[r.key] = r.value;
    }
    res.json({
      ...map,
      siteName: map.siteName ?? "Readora",
      allowRegistration: map.allowRegistration !== "false",
      maxFileSizeMb: validateQuotaSetting(map.maxFileSizeMb ? Number(map.maxFileSizeMb) : undefined, quotaSettingBounds.maxBookFileSizeMb) ?? DEFAULT_MAX_BOOK_FILE_SIZE_MB,
      libraryStorageLimitMb: validateQuotaSetting(map.libraryStorageLimitMb ? Number(map.libraryStorageLimitMb) : undefined, quotaSettingBounds.libraryStorageMb) ?? DEFAULT_LIBRARY_STORAGE_MB,
      smtpHost: map.smtpHost ?? null,
      smtpPort: map.smtpPort ? Number.parseInt(map.smtpPort, 10) : null,
      smtpUser: map.smtpUser ?? null,
      smtpFrom: map.smtpFrom ?? null,
      appBaseUrl: map.app_base_url ?? null,
      feedbackEmail: map.feedbackEmail ?? null,
      maintenanceMode: map.maintenanceMode === "true",
      maintenanceReason: map.maintenanceReason ?? null,
      maintenanceEta: map.maintenanceEta ?? null,
      maintenanceMessage: map.maintenanceMessage ?? null,
      emailSaveToFiles: map.email_save_to_files === "true",
    });
  },
);

// GET /public/maintenance-status - публичный endpoint для проверки режима обслуживания
router.get("/public/maintenance-status", async (_req, res): Promise<void> => {
  res.json(await getMaintenanceStatus());
});

router.get("/public/registration-status", async (_req, res): Promise<void> => {
  res.json({ enabled: await isRegistrationEnabled() });
});

// POST /admin/smtp/test — отправить тестовое письмо текущими настройками из БД
router.post(
  "/admin/smtp/test",
  requireAdmin,
  async (req, res): Promise<void> => {
    let to = "";
    if (typeof req.body?.to === "string") {
      to = req.body.to.trim();
    } else if (typeof req.body?.testEmail === "string") {
      to = req.body.testEmail.trim();
    }
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      res
        .status(400)
        .json({ ok: false, error: "Укажите корректный email получателя" });
      return;
    }

    // По референсу: сбрасываем транспорт перед тестом, чтобы использовать
    // последние сохранённые настройки без перезапуска сервера.
    emailService.resetTransporter();
    const result = await emailService.sendTestEmail(to);

    if (result.success) {
      res.json({ ok: true, messageId: result.messageId });
      return;
    }

    const errorMessage =
      result.error ?? "Не удалось отправить письмо. Проверьте настройки SMTP.";
    logger.warn(
      {
        to,
        errorMessage,
        smtpCode: result.code,
      },
      "SMTP test send failed",
    );

    if (
      errorMessage.includes("не настроен") ||
      errorMessage.includes("отключен") ||
      errorMessage.includes("invalid") ||
      result.code === "EAUTH" ||
      result.code === "EENVELOPE"
    ) {
      res.status(400).json({ ok: false, error: errorMessage });
      return;
    }

    if (
      result.code === "ECONNECTION" ||
      result.code === "ESOCKET" ||
      result.code === "ETIMEDOUT" ||
      result.code === "EDNS"
    ) {
      res.status(502).json({ ok: false, error: errorMessage });
      return;
    }

    res.status(500).json({ ok: false, error: errorMessage });
  },
);

// GET /admin/genres
router.get("/admin/genres", requireAdmin, async (_req, res): Promise<void> => {
  const genres = await db.select().from(genresTable).orderBy(genresTable.name);
  res.json(genres);
});

// POST /admin/genres
router.post("/admin/genres", requireAdmin, async (req, res): Promise<void> => {
  const { code, name, description, isActive } = req.body ?? {};
  if (!code || typeof code !== "string" || code.trim().length === 0) {
    res.status(400).json({ error: "Код жанра обязателен" });
    return;
  }
  if (!name || typeof name !== "string" || name.trim().length === 0) {
    res.status(400).json({ error: "Название жанра обязательно" });
    return;
  }
  const [genre] = await db
    .insert(genresTable)
    .values({
      code: code.trim(),
      name: name.trim(),
      description: description ? String(description).trim() : null,
      isActive: isActive ?? true,
    })
    .returning();
  res.status(201).json(genre);
});

// PATCH /admin/genres/:id
router.patch(
  "/admin/genres/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    const { code, name, description, isActive } = req.body ?? {};
    const updates: Record<string, unknown> = {};
    if (code !== undefined) {
      if (typeof code !== "string" || code.trim().length === 0) {
        res.status(400).json({ error: "Код жанра обязателен" });
        return;
      }
      updates.code = code.trim();
    }
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length === 0) {
        res.status(400).json({ error: "Название жанра обязательно" });
        return;
      }
      updates.name = name.trim();
    }
    if (description !== undefined)
      updates.description = description ? String(description).trim() : null;
    if (isActive !== undefined) updates.isActive = Boolean(isActive);

    const [genre] = await db
      .update(genresTable)
      .set(updates)
      .where(eq(genresTable.id, id))
      .returning();
    if (!genre) {
      res.status(404).json({ error: "Жанр не найден" });
      return;
    }
    res.json(genre);
  },
);

// DELETE /admin/genres/:id
router.delete(
  "/admin/genres/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    await db.delete(genresTable).where(eq(genresTable.id, id));
    res.sendStatus(204);
  },
);

// GET /admin/saved-emails - список сохранённых писем
router.get(
  "/admin/saved-emails",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const emails = await emailService.getSavedEmails();
    res.json(emails);
  },
);

// GET /admin/saved-emails/:id - просмотр конкретного письма
router.get(
  "/admin/saved-emails/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const email = await emailService.getSavedEmail(id);

    if (!email) {
      res.status(404).json({ error: "Письмо не найдено" });
      return;
    }

    res.json(email);
  },
);

// DELETE /admin/saved-emails/:id - удалить конкретное письмо
router.delete(
  "/admin/saved-emails/:id",
  requireAdmin,
  async (req, res): Promise<void> => {
    const id = String(req.params.id);
    const deleted = await emailService.deleteSavedEmail(id);

    if (!deleted) {
      res.status(404).json({ error: "Письмо не найдено" });
      return;
    }

    res.sendStatus(204);
  },
);

// DELETE /admin/saved-emails - очистить все письма
router.delete(
  "/admin/saved-emails",
  requireAdmin,
  async (_req, res): Promise<void> => {
    const count = await emailService.clearSavedEmails();
    res.json({ deleted: count });
  },
);

// Общий разбор фильтров статистики отзывов (используется в GET и DELETE).
const FEEDBACK_RANGE_DAYS = [7, 30, 90] as const;

function parseFeedbackFilters(query: Record<string, unknown>):
  | { daysParam: string; ratingParam: string; painPointParam: string; whereClause: SQL | undefined }
  | { error: string } {
  const daysParam = typeof query.days === "string" ? query.days : "all";
  let rangeStart: Date | null = null;
  if (daysParam !== "all") {
    const days = Number.parseInt(daysParam, 10);
    if (!FEEDBACK_RANGE_DAYS.includes(days as (typeof FEEDBACK_RANGE_DAYS)[number])) {
      return { error: "Период должен быть 7, 30, 90 дней или all" };
    }
    rangeStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }

  const ratingParam = typeof query.rating === "string" ? query.rating : "all";
  let ratingFilter: number | null = null;
  if (ratingParam !== "all") {
    const rating = Number.parseInt(ratingParam, 10);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return { error: "Оценка должна быть от 1 до 5 или all" };
    }
    ratingFilter = rating;
  }

  const painPointParam = typeof query.painPoint === "string" ? query.painPoint : "all";
  if (
    painPointParam !== "all" &&
    !FEEDBACK_PAIN_POINTS.includes(painPointParam as (typeof FEEDBACK_PAIN_POINTS)[number])
  ) {
    return { error: "Неизвестный тип жалобы" };
  }

  const whereClause = and(
    rangeStart ? gte(feedbackResponsesTable.createdAt, rangeStart) : undefined,
    ratingFilter ? eq(feedbackResponsesTable.rating, ratingFilter) : undefined,
    painPointParam !== "all"
      ? sql`${feedbackResponsesTable.painPoints} @> ${JSON.stringify([painPointParam])}::jsonb`
      : undefined,
  );

  return { daysParam, ratingParam, painPointParam, whereClause };
}

// GET /admin/feedback - статистика опроса с фильтрами (system admin only)
router.get(
  "/admin/feedback",
  requireSystemAdmin,
  async (req, res): Promise<void> => {
    const filters = parseFeedbackFilters(req.query);
    if ("error" in filters) {
      res.status(400).json({ error: filters.error });
      return;
    }
    const { daysParam, ratingParam, painPointParam, whereClause } = filters;
    // Лёгкий режим для сводки в «Обзоре»: без тренда и списка отзывов.
    const summaryOnly =
      req.query.summaryOnly === "1" || req.query.summaryOnly === "true";

    const requestedLimit = Number.parseInt(String(req.query.limit ?? "200"), 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(requestedLimit, 1), 500)
      : 200;

    const [summaryRow] = await db
      .select({
        total: sql<number>`count(*)::int`,
        averageRating: sql<number>`coalesce(avg(${feedbackResponsesTable.rating}), 0)::float`,
        lowRatings: sql<number>`count(*) filter (where ${feedbackResponsesTable.rating} <= 4)::int`,
        contactRequests: sql<number>`count(*) filter (where ${feedbackResponsesTable.wantsContact})::int`,
      })
      .from(feedbackResponsesTable)
      .where(whereClause);

    const distributionRows = await db
      .select({
        rating: feedbackResponsesTable.rating,
        count: sql<number>`count(*)::int`,
      })
      .from(feedbackResponsesTable)
      .where(whereClause)
      .groupBy(feedbackResponsesTable.rating);

    const distributionMap = new Map(distributionRows.map((row) => [row.rating, row.count]));
    const distribution = [1, 2, 3, 4, 5].map((rating) => ({
      rating,
      count: distributionMap.get(rating) ?? 0,
    }));

    const painPointResult = await db.execute(sql`
      select point as label, count(*)::int as count
      from ${feedbackResponsesTable}, jsonb_array_elements_text(${feedbackResponsesTable.painPoints}) as point
      ${whereClause ? sql`where ${whereClause}` : sql``}
      group by point
      order by count(*) desc
    `);
    const topPainPoints = (painPointResult.rows as Array<{ label: string; count: number }>).map((row) => ({
      label: row.label,
      count: row.count,
    }));

    const trendRows = summaryOnly
      ? []
      : await db
          .select({
            day: sql<string>`to_char(${feedbackResponsesTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
            count: sql<number>`count(*)::int`,
            averageRating: sql<number>`coalesce(avg(${feedbackResponsesTable.rating}), 0)::float`,
          })
          .from(feedbackResponsesTable)
          .where(whereClause)
          .groupBy(sql`to_char(${feedbackResponsesTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`)
          .orderBy(sql`to_char(${feedbackResponsesTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD') asc`);

    const rows = summaryOnly
      ? []
      : await db
          .select({
            id: feedbackResponsesTable.id,
            rating: feedbackResponsesTable.rating,
            painPoints: feedbackResponsesTable.painPoints,
            missingFeature: feedbackResponsesTable.missingFeature,
            wantsContact: feedbackResponsesTable.wantsContact,
            contactInfo: feedbackResponsesTable.contactInfo,
            pageUrl: feedbackResponsesTable.pageUrl,
            createdAt: feedbackResponsesTable.createdAt,
            userId: feedbackResponsesTable.userId,
            username: usersTable.username,
            email: usersTable.email,
          })
          .from(feedbackResponsesTable)
          .leftJoin(usersTable, eq(feedbackResponsesTable.userId, usersTable.id))
          .where(whereClause)
          .orderBy(desc(feedbackResponsesTable.createdAt))
          .limit(limit);

    const total = summaryRow?.total ?? 0;
    const contactRequests = summaryRow?.contactRequests ?? 0;

    res.json({
      filters: {
        days: daysParam,
        rating: ratingParam,
        painPoint: painPointParam,
        painPointOptions: [...FEEDBACK_PAIN_POINTS],
      },
      summary: {
        total,
        averageRating: Number((summaryRow?.averageRating ?? 0).toFixed(2)),
        lowRatings: summaryRow?.lowRatings ?? 0,
        contactRequests,
        contactRate: total === 0 ? 0 : Number(((contactRequests / total) * 100).toFixed(1)),
        distribution,
        topPainPoints,
        trend: trendRows.map((row) => ({
          day: row.day,
          count: row.count,
          averageRating: Number(row.averageRating.toFixed(2)),
        })),
      },
      items: rows.map((row) => ({
        id: row.id,
        rating: row.rating,
        painPoints: row.painPoints ?? [],
        missingFeature: row.missingFeature,
        wantsContact: row.wantsContact,
        contactInfo: row.wantsContact ? row.contactInfo : null,
        pageUrl: row.pageUrl,
        createdAt: row.createdAt,
        user: row.userId
          ? { id: row.userId, username: row.username ?? null, email: row.email ?? null }
          : null,
      })),
    });
  },
);

// DELETE /admin/feedback - удалить отзывы, соответствующие фильтрам (system admin only)
router.delete(
  "/admin/feedback",
  requireSystemAdmin,
  async (req, res): Promise<void> => {
    const filters = parseFeedbackFilters(req.query);
    if ("error" in filters) {
      res.status(400).json({ error: filters.error });
      return;
    }
    const { whereClause } = filters;

    const deleted = await db.transaction(async (tx) => {
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(feedbackResponsesTable)
        .where(whereClause);
      await tx.delete(feedbackResponsesTable).where(whereClause);
      return count;
    });

    res.json({ deleted });
  },
);

// DELETE /admin/feedback/:id - удалить один отзыв (system admin only)
router.delete(
  "/admin/feedback/:id",
  requireSystemAdmin,
  async (req, res): Promise<void> => {
    const id = Number.parseInt(String(req.params.id), 10);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ error: "Некорректный идентификатор отзыва" });
      return;
    }
    const deleted = await db
      .delete(feedbackResponsesTable)
      .where(eq(feedbackResponsesTable.id, id))
      .returning({ id: feedbackResponsesTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Отзыв не найден" });
      return;
    }
    res.json({ deleted: deleted.length });
  },
);

export default router;
