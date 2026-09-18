import { Router } from "express";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import os from "node:os";
import { statfs } from "node:fs/promises";
import {
  db,
  usersTable,
  booksTable,
  genresTable,
  readEventsTable,
  appSettingsTable,
  MAINTENANCE_MODE_KEY,
  MAINTENANCE_REASON_KEY,
  MAINTENANCE_ETA_KEY,
  MAINTENANCE_MESSAGE_KEY,
  analyticsDailyBookActivityTable,
  analyticsDailyUserActivityTable,
  readingProgressTable,
} from "@workspace/db";
import { requireAdmin, requireSystemAdmin } from "../middlewares/auth";
import { formatUser } from "./auth";
import { emailService } from "../lib/email-service";
import { logger } from "../lib/logger";
import { deleteStoredFilesIfUnreferenced, normalizeBookIds } from "../lib/book-deletion-service";
import { getMaintenanceStatus } from "../lib/maintenance-status";
import { isRegistrationEnabled } from "../lib/registration-status";

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
  const [{ openCount7d }] = await db
    .select({ openCount7d: sql<number>`count(*)::int` })
    .from(readEventsTable)
    .where(sql`${readEventsTable.createdAt} > ${sevenDaysAgo}`);

  const [{ activeReaders }] = await db
    .select({
      activeReaders: sql<number>`count(distinct ${readEventsTable.userId})::int`,
    })
    .from(readEventsTable)
    .where(sql`${readEventsTable.createdAt} > ${sevenDaysAgo}`);

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
    openCount7d,
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
  const periodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const inRange = sql`${analyticsDailyUserActivityTable.activityDate} >= ${rangeStart}::date and ${analyticsDailyUserActivityTable.activityDate} <= ${rangeEnd}::date`;
  const bookInRange = sql`${analyticsDailyBookActivityTable.activityDate} >= ${rangeStart}::date and ${analyticsDailyBookActivityTable.activityDate} <= ${rangeEnd}::date`;

  const [summaryRows, trend, bookSummaryRows, totalUserRows, totalBookRows, readingRows, pwaRows, marketingRows, registrationTrend, referralSources, retentionRows, completionRows] = await Promise.all([
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
        bookOpens: sql<number>`count(*)::int`,
      })
      .from(readEventsTable)
      .where(sql`${readEventsTable.createdAt} > ${periodStart}`),
    db
      .select({ value: appSettingsTable.value })
      .from(appSettingsTable)
      .where(eq(appSettingsTable.key, PWA_INSTALL_ACCEPTED_KEY))
      .limit(1),
    db
      .select({
        registrations: sql<number>`count(*)::int`,
        verifiedUsers: sql<number>`count(*) filter (where ${usersTable.emailVerifiedAt} is not null)::int`,
        usersWithBooks: sql<number>`count(*) filter (where exists (
          select 1 from ${booksTable} as uploaded_book where uploaded_book.owner_user_id = ${usersTable.id}
        ))::int`,
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
                and (day_zero_event.created_at at time zone 'UTC')::date = registered_at
            )
        )::int as "d7EligibleUsers",
        count(*) filter (
          where registered_at <= current_utc_date - 7
            and exists (
              select 1 from read_events as day_zero_event
              where day_zero_event.user_id = cohort_user.id
                and (day_zero_event.created_at at time zone 'UTC')::date = registered_at
            )
            and exists (
              select 1 from read_events as return_event
              where return_event.user_id = cohort_user.id
                and (return_event.created_at at time zone 'UTC')::date > registered_at
                and (return_event.created_at at time zone 'UTC')::date <= registered_at + 7
            )
        )::int as "d7RetainedUsers",
        count(*) filter (
          where registered_at <= current_utc_date - 30
            and exists (
              select 1 from read_events as day_zero_event
              where day_zero_event.user_id = cohort_user.id
                and (day_zero_event.created_at at time zone 'UTC')::date = registered_at
            )
        )::int as "d30EligibleUsers",
        count(*) filter (
          where registered_at <= current_utc_date - 30
            and exists (
              select 1 from read_events as day_zero_event
              where day_zero_event.user_id = cohort_user.id
                and (day_zero_event.created_at at time zone 'UTC')::date = registered_at
            )
            and exists (
              select 1 from read_events as return_event
              where return_event.user_id = cohort_user.id
                and (return_event.created_at at time zone 'UTC')::date > registered_at
                and (return_event.created_at at time zone 'UTC')::date <= registered_at + 30
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

  res.json({
    days,
    rangeStart,
    rangeEnd,
    systemSummary: {
      totalUsers: totalUserRows[0].totalUsers,
      totalBooks: totalBookRows[0].totalBooks,
      activeReaders: readingRows[0].activeReaders,
      bookOpens: readingRows[0].bookOpens,
      pwaInstallAccepted: Number.isFinite(pwaInstallAccepted) ? pwaInstallAccepted : 0,
      booksPerUser: toRatio(totalBookRows[0].totalBooks, totalUserRows[0].totalUsers),
      readEventsPerActiveReader: toRatio(readingRows[0].bookOpens, readingRows[0].activeReaders),
      completedBooks,
      completedBooksRate: toRate(completedBooks, totalBookRows[0].totalBooks),
    },
    summary: {
      ...summary,
      syncSuccessRate,
      trackedBooks: bookSummaryRows[0].trackedBooks,
      averageSessionReadingMs: summary.readerSessions === 0 ? 0 : Math.round(summary.activeReadingMs / summary.readerSessions),
    },
    marketing: {
      registrations: marketing.registrations,
      verifiedUsers: marketing.verifiedUsers,
      emailVerificationRate: toRate(marketing.verifiedUsers, marketing.registrations),
      usersWithBooks: marketing.usersWithBooks,
      firstBookUploadRate: toRate(marketing.usersWithBooks, marketing.registrations),
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
  });
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
  const books = await db
    .select({ book: booksTable, username: usersTable.username })
    .from(booksTable)
    .leftJoin(usersTable, eq(booksTable.ownerUserId, usersTable.id))
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
      maxFileSizeMb: Number.parseInt(map.maxFileSizeMb ?? "50", 10),
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
      maxFileSizeMb: Number.parseInt(map.maxFileSizeMb ?? "50", 10),
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

export default router;
