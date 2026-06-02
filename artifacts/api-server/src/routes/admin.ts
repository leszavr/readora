import { Router } from "express";
import { eq, sql, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import os from "node:os";
import { statfs } from "node:fs/promises";
import { db, usersTable, booksTable, genresTable, readEventsTable, appSettingsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { formatUser } from "./auth";
import { emailService } from "../lib/email-service";
import { logger } from "../lib/logger";

const router = Router();

// GET /admin/system-metrics
router.get("/admin/system-metrics", requireAdmin, async (_req, res): Promise<void> => {
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
});

// GET /admin/stats
router.get("/admin/stats", requireAdmin, async (_req, res): Promise<void> => {
  const [{ totalUsers }] = await db.select({ totalUsers: sql<number>`count(*)::int` }).from(usersTable);
  const [{ totalBooks }] = await db.select({ totalBooks: sql<number>`count(*)::int` }).from(booksTable);

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [{ openCount7d }] = await db
    .select({ openCount7d: sql<number>`count(*)::int` })
    .from(readEventsTable)
    .where(sql`${readEventsTable.createdAt} > ${sevenDaysAgo}`);

  const [{ activeReaders }] = await db
    .select({ activeReaders: sql<number>`count(distinct ${readEventsTable.userId})::int` })
    .from(readEventsTable)
    .where(sql`${readEventsTable.createdAt} > ${sevenDaysAgo}`);

  const recentBooksRaw = await db.select().from(booksTable).orderBy(desc(booksTable.uploadedAt)).limit(5);
  const recentUsersRaw = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt)).limit(5);

  const recentBooks = recentBooksRaw.map((b) => ({
    id: b.id, title: b.title, author: b.author ?? null, format: b.format, status: b.status,
    ownerUsername: null, ownerId: b.ownerUserId, fileSize: b.fileSize, uploadedAt: b.uploadedAt,
  }));

  const recentUsers = recentUsersRaw.map(formatUser);

  res.json({ totalUsers, totalBooks, activeReaders, openCount7d, recentBooks, recentUsers });
});

// GET /admin/users
router.get("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const { search, role, status } = req.query as Record<string, string>;
  const users = await db.select().from(usersTable).orderBy(desc(usersTable.createdAt));

  let result = users;
  if (search) result = result.filter((u) => u.email.includes(search) || u.username.toLowerCase().includes(search.toLowerCase()));
  if (role) result = result.filter((u) => u.role === role);
  if (status) result = result.filter((u) => u.status === status);

  const withCounts = await Promise.all(result.map(async (u) => {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(booksTable).where(eq(booksTable.ownerUserId, u.id));
    return { ...formatUser(u), bookCount: count };
  }));

  res.json(withCounts);
});

// POST /admin/users
router.post("/admin/users", requireAdmin, async (req, res): Promise<void> => {
  const { email, password, username, role } = req.body ?? {};
  if (!email || !password || !username) { res.status(400).json({ error: "Все поля обязательны" }); return; }
  const passwordHash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usersTable).values({ email, username, passwordHash, role: role ?? "user" }).returning();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(booksTable).where(eq(booksTable.ownerUserId, user.id));
  res.status(201).json({ ...formatUser(user), bookCount: count });
});

// GET /admin/users/:id
router.get("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "Пользователь не найден" }); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(booksTable).where(eq(booksTable.ownerUserId, id));
  res.json({ ...formatUser(user), bookCount: count });
});

// PATCH /admin/users/:id
router.patch("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const { username, email, role, status } = req.body ?? {};
  const updates: Partial<typeof usersTable.$inferSelect> = {};
  if (username != null) updates.username = username;
  if (email != null) updates.email = email;
  if (role != null) updates.role = role;
  if (status != null) updates.status = status;
  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, id)).returning();
  if (!user) { res.status(404).json({ error: "Пользователь не найден" }); return; }
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(booksTable).where(eq(booksTable.ownerUserId, id));
  res.json({ ...formatUser(user), bookCount: count });
});

// DELETE /admin/users/:id
router.delete("/admin/users/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.sendStatus(204);
});

// POST /admin/users/:id/toggle-block
router.post("/admin/users/:id/toggle-block", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, id));
  if (!user) { res.status(404).json({ error: "Пользователь не найден" }); return; }
  const newStatus = user.status === "active" ? "blocked" : "active";
  const [updated] = await db.update(usersTable).set({ status: newStatus }).where(eq(usersTable.id, id)).returning();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(booksTable).where(eq(booksTable.ownerUserId, id));
  res.json({ ...formatUser(updated), bookCount: count });
});

// GET /admin/books
router.get("/admin/books", requireAdmin, async (req, res): Promise<void> => {
  const { search } = req.query as Record<string, string>;
  const books = await db
    .select({ book: booksTable, username: usersTable.username })
    .from(booksTable)
    .leftJoin(usersTable, eq(booksTable.ownerUserId, usersTable.id))
    .orderBy(desc(booksTable.uploadedAt));

  let result = books;
  if (search) result = result.filter((r) => r.book.title.toLowerCase().includes(search.toLowerCase()) || (r.book.author ?? "").toLowerCase().includes(search.toLowerCase()));

  res.json(result.map((r) => ({
    id: r.book.id, title: r.book.title, author: r.book.author ?? null, format: r.book.format,
    status: r.book.status, ownerUsername: r.username ?? null, ownerId: r.book.ownerUserId,
    fileSize: r.book.fileSize, uploadedAt: r.book.uploadedAt,
  })));
});

// GET /admin/books/:id
router.get("/admin/books/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const [result] = await db.select({ book: booksTable, username: usersTable.username }).from(booksTable).leftJoin(usersTable, eq(booksTable.ownerUserId, usersTable.id)).where(eq(booksTable.id, id));
  if (!result) { res.status(404).json({ error: "Книга не найдена" }); return; }
  res.json({ id: result.book.id, title: result.book.title, author: result.book.author ?? null, format: result.book.format, status: result.book.status, ownerUsername: result.username ?? null, ownerId: result.book.ownerUserId, fileSize: result.book.fileSize, uploadedAt: result.book.uploadedAt });
});

// DELETE /admin/books/:id
router.delete("/admin/books/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  await db.delete(booksTable).where(eq(booksTable.id, id));
  res.sendStatus(204);
});

// POST /admin/books/:id/toggle-block
router.post("/admin/books/:id/toggle-block", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, id));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const [updated] = await db.update(booksTable).set({ status: book.status === "active" ? "blocked" : "active" }).where(eq(booksTable.id, id)).returning();
  const [owner] = await db.select().from(usersTable).where(eq(usersTable.id, updated.ownerUserId));
  res.json({ id: updated.id, title: updated.title, author: updated.author ?? null, format: updated.format, status: updated.status, ownerUsername: owner?.username ?? null, ownerId: updated.ownerUserId, fileSize: updated.fileSize, uploadedAt: updated.uploadedAt });
});

// GET /admin/settings
const SENSITIVE_KEYS = new Set(["smtp_password", "smtpPassword"]);

router.get("/admin/settings", requireAdmin, async (_req, res): Promise<void> => {
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
  });
});

// PATCH /admin/settings
function normalizeSettingValue(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

router.patch("/admin/settings", requireAdmin, async (req, res): Promise<void> => {
  const updates = req.body ?? {};
  let smtpTouched = false;
  for (const [key, value] of Object.entries(updates)) {
    const strVal = normalizeSettingValue(value);
    // Пароли: не затирать пустым значением (фронт не получает пароль при GET)
    if (SENSITIVE_KEYS.has(key) && (strVal === null || strVal.length === 0)) continue;
    await db
      .insert(appSettingsTable)
      .values({ key, value: strVal })
      .onConflictDoUpdate({ target: appSettingsTable.key, set: { value: strVal } });
    if (key.startsWith("smtp_") || key.startsWith("smtp")) smtpTouched = true;
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
  });
});

// POST /admin/smtp/test — отправить тестовое письмо текущими настройками из БД
router.post("/admin/smtp/test", requireAdmin, async (req, res): Promise<void> => {
  let to = "";
  if (typeof req.body?.to === "string") {
    to = req.body.to.trim();
  } else if (typeof req.body?.testEmail === "string") {
    to = req.body.testEmail.trim();
  }
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    res.status(400).json({ ok: false, error: "Укажите корректный email получателя" });
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

  const errorMessage = result.error ?? "Не удалось отправить письмо. Проверьте настройки SMTP.";
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
});

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
  const [genre] = await db.insert(genresTable).values({ 
    code: code.trim(), 
    name: name.trim(),
    description: description ? String(description).trim() : null,
    isActive: isActive ?? true
  }).returning();
  res.status(201).json(genre);
});

// PATCH /admin/genres/:id
router.patch("/admin/genres/:id", requireAdmin, async (req, res): Promise<void> => {
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
  if (description !== undefined) updates.description = description ? String(description).trim() : null;
  if (isActive !== undefined) updates.isActive = Boolean(isActive);
  
  const [genre] = await db.update(genresTable).set(updates).where(eq(genresTable.id, id)).returning();
  if (!genre) {
    res.status(404).json({ error: "Жанр не найден" });
    return;
  }
  res.json(genre);
});

// DELETE /admin/genres/:id
router.delete("/admin/genres/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  await db.delete(genresTable).where(eq(genresTable.id, id));
  res.sendStatus(204);
});

export default router;
