import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, chaptersTable, readingProgressTable, readerSettingsTable, booksTable, readEventsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import type { Request } from "express";
import type { usersTable } from "@workspace/db";

const router = Router();
type AuthReq = Request & { user: typeof usersTable.$inferSelect };
type DeviceMode = "desktop" | "mobile";
type ReaderTheme = "light" | "sepia" | "dark";

function parseDeviceMode(value: unknown): DeviceMode {
  return value === "mobile" ? "mobile" : "desktop";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function normalizeReaderSettings(input: Record<string, unknown>, deviceMode: DeviceMode): {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  theme: ReaderTheme;
  contentWidth: number;
} {
  const fallback = deviceMode === "mobile"
    ? { fontSize: 16, fontFamily: "Georgia", lineHeight: 1.6, theme: "light" as const, contentWidth: 95 }
    : { fontSize: 18, fontFamily: "Georgia", lineHeight: 1.7, theme: "light" as const, contentWidth: 80 };
  const theme: ReaderTheme = input.theme === "dark" || input.theme === "sepia" || input.theme === "light" ? input.theme : fallback.theme;
  return {
    fontSize: Math.round(clampNumber(input.fontSize, 12, 32, fallback.fontSize)),
    fontFamily: typeof input.fontFamily === "string" && input.fontFamily.trim() ? input.fontFamily : fallback.fontFamily,
    lineHeight: Math.round(clampNumber(input.lineHeight, 1.2, 2.5, fallback.lineHeight) * 10) / 10,
    theme,
    contentWidth: Math.round(clampNumber(input.contentWidth, 50, 95, fallback.contentWidth)),
  };
}

// GET /books/:id/chapters — table of contents
router.get("/books/:id/chapters", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);

  const [book] = await db.select().from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }

  const chapters = await db
    .select({ id: chaptersTable.id, bookId: chaptersTable.bookId, index: chaptersTable.index, title: chaptersTable.title, wordCount: chaptersTable.wordCount })
    .from(chaptersTable)
    .where(eq(chaptersTable.bookId, bookId))
    .orderBy(chaptersTable.index);

  // Log open event
  await db.insert(readEventsTable).values({ bookId, userId: user.id, eventType: "open" }).catch(() => {});

  res.json(chapters);
});

// GET /books/:id/chapters/:chapterId — chapter content
router.get("/books/:id/chapters/:chapterId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const chapterId = parseInt(String(req.params.chapterId), 10);

  const [book] = await db.select().from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(403).json({ error: "Доступ запрещён" }); return; }

  const [chapter] = await db.select().from(chaptersTable).where(and(eq(chaptersTable.id, chapterId), eq(chaptersTable.bookId, bookId)));
  if (!chapter) { res.status(404).json({ error: "Глава не найдена" }); return; }

  res.json({
    id: chapter.id,
    bookId: chapter.bookId,
    index: chapter.index,
    title: chapter.title,
    htmlContent: chapter.htmlContent,
    wordCount: chapter.wordCount ?? null,
  });
});

// GET /books/:id/progress
router.get("/books/:id/progress", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);

  const [progress] = await db
    .select()
    .from(readingProgressTable)
    .where(and(eq(readingProgressTable.userId, user.id), eq(readingProgressTable.bookId, bookId)));

  res.json({
    bookId,
    userId: user.id,
    currentChapterId: progress?.currentChapterId ?? null,
    currentPosition: progress?.currentPosition ?? null,
    progressPercent: progress?.progressPercent ?? null,
    readingStatus: progress?.readingStatus ?? "not_started",
    lastReadAt: progress?.lastReadAt ?? null,
    completedAt: progress?.completedAt ?? null,
  });
});

// PUT /books/:id/progress
router.put("/books/:id/progress", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const { currentChapterId, currentPosition, progressPercent, readingStatus } = req.body ?? {};

  const values: typeof readingProgressTable.$inferInsert = {
    userId: user.id,
    bookId,
    currentChapterId: currentChapterId ?? null,
    currentPosition: currentPosition ?? null,
    progressPercent: progressPercent ?? null,
    readingStatus: readingStatus ?? "reading",
    lastReadAt: new Date(),
    completedAt: readingStatus === "finished" ? new Date() : null,
  };

  await db
    .insert(readingProgressTable)
    .values(values)
    .onConflictDoUpdate({
      target: [readingProgressTable.userId, readingProgressTable.bookId],
      set: {
        currentChapterId: values.currentChapterId,
        currentPosition: values.currentPosition,
        progressPercent: values.progressPercent,
        readingStatus: values.readingStatus,
        lastReadAt: values.lastReadAt,
        completedAt: values.completedAt,
      },
    });

  const [saved] = await db
    .select()
    .from(readingProgressTable)
    .where(and(eq(readingProgressTable.userId, user.id), eq(readingProgressTable.bookId, bookId)));

  res.json({
    bookId,
    userId: user.id,
    currentChapterId: saved?.currentChapterId ?? null,
    currentPosition: saved?.currentPosition ?? null,
    progressPercent: saved?.progressPercent ?? null,
    readingStatus: saved?.readingStatus ?? "not_started",
    lastReadAt: saved?.lastReadAt ?? null,
    completedAt: saved?.completedAt ?? null,
  });
});

// GET /reader/settings
router.get("/reader/settings", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const deviceMode = parseDeviceMode(req.query.deviceMode);
  const fallback = normalizeReaderSettings({}, deviceMode);
  const [settings] = await db.select().from(readerSettingsTable).where(and(eq(readerSettingsTable.userId, user.id), eq(readerSettingsTable.deviceMode, deviceMode)));
  res.json({
    userId: user.id,
    deviceMode,
    fontSize: settings?.fontSize ?? fallback.fontSize,
    fontFamily: settings?.fontFamily ?? fallback.fontFamily,
    lineHeight: settings?.lineHeight ?? fallback.lineHeight,
    theme: settings?.theme ?? fallback.theme,
    contentWidth: settings?.contentWidth ?? fallback.contentWidth,
  });
});

// PUT /reader/settings
router.put("/reader/settings", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const deviceMode = parseDeviceMode(req.query.deviceMode ?? req.body?.deviceMode);
  const normalized = normalizeReaderSettings(req.body ?? {}, deviceMode);

  await db
    .insert(readerSettingsTable)
    .values({ userId: user.id, deviceMode, ...normalized })
    .onConflictDoUpdate({
      target: [readerSettingsTable.userId, readerSettingsTable.deviceMode],
      set: {
        ...normalized,
      },
    });

  const [settings] = await db.select().from(readerSettingsTable).where(and(eq(readerSettingsTable.userId, user.id), eq(readerSettingsTable.deviceMode, deviceMode)));
  res.json({ userId: user.id, deviceMode, fontSize: settings.fontSize, fontFamily: settings.fontFamily, lineHeight: settings.lineHeight, theme: settings.theme, contentWidth: settings.contentWidth });
});

// DELETE /reader/settings
router.delete("/reader/settings", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const deviceMode = parseDeviceMode(req.query.deviceMode);
  await db.delete(readerSettingsTable).where(and(eq(readerSettingsTable.userId, user.id), eq(readerSettingsTable.deviceMode, deviceMode)));
  res.json({ userId: user.id, deviceMode, ...normalizeReaderSettings({}, deviceMode) });
});

export default router;
