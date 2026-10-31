import { Router } from "express";
import { eq, and, sql, inArray } from "drizzle-orm";
import { db, chaptersTable, readingProgressTable, readerSettingsTable, booksTable, readEventsTable, bookmarksTable, notesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import type { Request } from "express";
import type { usersTable } from "@workspace/db";
import { recordServerAnalyticsEvent } from "../lib/analytics-service";
import { getContentBookId } from "../lib/gift-editions-service";
import { resolveProgressUpdate } from "../lib/reading-progress";

const router = Router();
type AuthReq = Request & { user: typeof usersTable.$inferSelect };
type DeviceMode = "desktop" | "mobile";
type ReaderTheme = "light" | "sepia" | "dark";
const knownFontFamilies = new Set(["Georgia", "Arial", "Times New Roman", "Verdana", "Palatino"]);

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

function readerSettingValueBucket(setting: string, value: string | number): string | number {
  if (setting === "font_family") return knownFontFamilies.has(String(value)) ? String(value) : "custom";
  return value;
}

// Книги цикла пользователя (для сквозных заметок/закладок). Без цикла — только сама книга.
async function listCycleBooks(ownerUserId: number, cycleId: number | null, selfBookId: number, selfBookTitle: string): Promise<Array<{ id: number; title: string }>> {
  if (cycleId === null) return [{ id: selfBookId, title: selfBookTitle }];
  const rows = await db
    .select({ id: booksTable.id, title: booksTable.title })
    .from(booksTable)
    .where(and(eq(booksTable.ownerUserId, ownerUserId), eq(booksTable.cycleId, cycleId)));
  return rows.length > 0 ? rows : [{ id: selfBookId, title: selfBookTitle }];
}

// Принадлежит ли книга bookId тому же циклу (для правки/удаления заметок из других книг цикла).
async function bookInSameCycle(ownerUserId: number, cycleId: number | null, otherBookId: number): Promise<boolean> {
  if (cycleId === null || otherBookId <= 0) return false;
  const [row] = await db
    .select({ id: booksTable.id })
    .from(booksTable)
    .where(and(eq(booksTable.id, otherBookId), eq(booksTable.ownerUserId, ownerUserId), eq(booksTable.cycleId, cycleId)));
  return !!row;
}

// GET /books/:id/chapters — table of contents
router.get("/books/:id/chapters", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);

  const [book] = await db.select().from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }

  const chapters = await db
    .select({ id: chaptersTable.id, index: chaptersTable.index, title: chaptersTable.title, wordCount: chaptersTable.wordCount })
    .from(chaptersTable)
    .where(eq(chaptersTable.bookId, getContentBookId(book)))
    .orderBy(chaptersTable.index);

  res.json(chapters.map((chapter) => ({ ...chapter, bookId })));
});

// GET /books/:id/chapters/:chapterId — chapter content
router.get("/books/:id/chapters/:chapterId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const chapterId = parseInt(String(req.params.chapterId), 10);

  const [book] = await db.select().from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(403).json({ error: "Доступ запрещён" }); return; }

  const [chapter] = await db.select().from(chaptersTable).where(and(eq(chaptersTable.id, chapterId), eq(chaptersTable.bookId, getContentBookId(book))));
  if (!chapter) { res.status(404).json({ error: "Глава не найдена" }); return; }

  res.json({
    id: chapter.id,
    bookId,
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

  req.log.info(
    {
      userId: user.id,
      bookId,
      currentChapterId: progress?.currentChapterId ?? null,
      progressPercent: progress?.progressPercent ?? null,
      readingStatus: progress?.readingStatus ?? "not_started",
    },
    "[Reader] GET progress"
  );

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
  const [book] = await db.select({ id: booksTable.id, contentBookId: booksTable.contentBookId }).from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const { currentChapterId, currentPosition, progressPercent, readingStatus } = req.body ?? {};
  const normalizedCurrentChapterId = typeof currentChapterId === "number" && Number.isInteger(currentChapterId)
    ? currentChapterId
    : null;
  const normalizedCurrentPosition = typeof currentPosition === "string"
    ? currentPosition
    : null;
  const normalizedProgressPercent = typeof progressPercent === "number" && Number.isFinite(progressPercent)
    ? progressPercent
    : null;
  const normalizedReadingStatus = readingStatus === "not_started" || readingStatus === "reading" || readingStatus === "finished"
    ? readingStatus
    : "reading";

  req.log.info(
    {
      userId: user.id,
      bookId,
      currentChapterId: normalizedCurrentChapterId,
      progressPercent: normalizedProgressPercent,
      readingStatus: normalizedReadingStatus,
      positionLength: normalizedCurrentPosition?.length ?? 0,
    },
    "[Reader] PUT progress - saving"
  );

  const values: typeof readingProgressTable.$inferInsert = {
    userId: user.id,
    bookId,
    currentChapterId: normalizedCurrentChapterId,
    currentPosition: normalizedCurrentPosition,
    progressPercent: normalizedProgressPercent,
    readingStatus: normalizedReadingStatus,
    lastReadAt: new Date(),
    completedAt: normalizedReadingStatus === "finished" ? new Date() : null,
  };

  const [previous] = await db
    .select({
      readingStatus: readingProgressTable.readingStatus,
      progressPercent: readingProgressTable.progressPercent,
      completedAt: readingProgressTable.completedAt,
    })
    .from(readingProgressTable)
    .where(and(eq(readingProgressTable.userId, user.id), eq(readingProgressTable.bookId, bookId)));

  // Прочитанная книга не должна снова становиться «читаемой» при повторном
  // открытии: иначе она пропадает с книжной полки, а completedAt обнуляется.
  const resolved = resolveProgressUpdate(
    previous
      ? {
          readingStatus: previous.readingStatus,
          progressPercent: previous.progressPercent,
          completedAt: previous.completedAt,
        }
      : null,
    { progressPercent: normalizedProgressPercent, readingStatus: normalizedReadingStatus },
  );
  const finalReadingStatus = resolved.readingStatus;
  const finalProgressPercent = resolved.progressPercent;
  const finalCompletedAt = resolved.completedAt;

  await db
    .insert(readingProgressTable)
    .values({
      ...values,
      progressPercent: finalProgressPercent,
      readingStatus: finalReadingStatus,
      completedAt: finalCompletedAt,
    })
    .onConflictDoUpdate({
      target: [readingProgressTable.userId, readingProgressTable.bookId],
      set: {
        currentChapterId: values.currentChapterId,
        currentPosition: values.currentPosition,
        progressPercent: sql`CASE
          WHEN ${readingProgressTable.readingStatus} = 'finished'::reading_status
            AND ${finalReadingStatus} <> 'finished'
          THEN GREATEST(COALESCE(${readingProgressTable.progressPercent}, 0), COALESCE(${finalProgressPercent}, 0))
          ELSE ${finalProgressPercent}
        END`,
        readingStatus: sql`CASE
          WHEN ${readingProgressTable.readingStatus} = 'finished'::reading_status
            AND ${finalReadingStatus} <> 'finished'
          THEN 'finished'::reading_status
          ELSE ${finalReadingStatus}::reading_status
        END`,
        lastReadAt: values.lastReadAt,
        completedAt: sql`CASE
          WHEN ${readingProgressTable.readingStatus} = 'finished'::reading_status
            AND ${finalReadingStatus} <> 'finished'
          THEN COALESCE(${readingProgressTable.completedAt}, ${finalCompletedAt})
          ELSE ${finalCompletedAt}
        END`,
      },
    });
  await db.insert(readEventsTable).values({ bookId, userId: user.id, eventType: "progress_saved" }).catch(() => {});

  const [saved] = await db
    .select()
    .from(readingProgressTable)
    .where(and(eq(readingProgressTable.userId, user.id), eq(readingProgressTable.bookId, bookId)));

  const previousStatus = previous?.readingStatus ?? "not_started";
  const savedStatus = saved?.readingStatus ?? "not_started";
  if (previousStatus !== savedStatus) {
    await recordServerAnalyticsEvent(user, {
      bookId,
      eventName: "book_status_changed",
      properties: { from: previousStatus, to: savedStatus },
    });
    if (savedStatus === "finished") {
      await recordServerAnalyticsEvent(user, {
        bookId,
        eventName: "book_completed",
        properties: { completionMode: normalizedProgressPercent === 100 ? "auto_progress" : "manual_status" },
      });
    }
  }

  req.log.info(
    {
      userId: user.id,
      bookId,
      currentChapterId: saved?.currentChapterId ?? null,
      progressPercent: saved?.progressPercent ?? null,
      readingStatus: saved?.readingStatus ?? "not_started",
    },
    "[Reader] PUT progress - saved"
  );

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

// POST /books/:id/complete — отметить книгу прочитанной вручную
router.post("/books/:id/complete", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);

  const [book] = await db
    .select({ id: booksTable.id })
    .from(booksTable)
    .where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) {
    res.status(404).json({ error: "Книга не найдена" });
    return;
  }

  const [previous] = await db
    .select()
    .from(readingProgressTable)
    .where(and(eq(readingProgressTable.userId, user.id), eq(readingProgressTable.bookId, bookId)));

  const now = new Date();
  const completedAt = previous?.completedAt ?? now;

  await db
    .insert(readingProgressTable)
    .values({
      userId: user.id,
      bookId,
      currentChapterId: previous?.currentChapterId ?? null,
      currentPosition: previous?.currentPosition ?? null,
      progressPercent: 100,
      readingStatus: "finished",
      lastReadAt: now,
      completedAt,
    })
    .onConflictDoUpdate({
      target: [readingProgressTable.userId, readingProgressTable.bookId],
      set: {
        progressPercent: 100,
        readingStatus: "finished",
        lastReadAt: now,
        completedAt,
      },
    });

  if (previous?.readingStatus !== "finished") {
    await recordServerAnalyticsEvent(user, {
      bookId,
      eventName: "book_status_changed",
      properties: { from: previous?.readingStatus ?? "not_started", to: "finished" },
    });
    await recordServerAnalyticsEvent(user, {
      bookId,
      eventName: "book_completed",
      properties: { completionMode: "manual_status" },
    });
  }

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

// POST /books/:id/reopen — начать повторное чтение с начала
router.post("/books/:id/reopen", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);

  const [book] = await db
    .select({ id: booksTable.id })
    .from(booksTable)
    .where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) {
    res.status(404).json({ error: "Книга не найдена" });
    return;
  }

  const [previous] = await db
    .select({ readingStatus: readingProgressTable.readingStatus })
    .from(readingProgressTable)
    .where(and(eq(readingProgressTable.userId, user.id), eq(readingProgressTable.bookId, bookId)));

  const now = new Date();
  await db
    .insert(readingProgressTable)
    .values({
      userId: user.id,
      bookId,
      currentChapterId: null,
      currentPosition: null,
      progressPercent: 0,
      readingStatus: "reading",
      lastReadAt: now,
      completedAt: null,
    })
    .onConflictDoUpdate({
      target: [readingProgressTable.userId, readingProgressTable.bookId],
      set: {
        currentChapterId: null,
        currentPosition: null,
        progressPercent: 0,
        readingStatus: "reading",
        lastReadAt: now,
        completedAt: null,
      },
    });

  if (previous?.readingStatus !== "reading") {
    await recordServerAnalyticsEvent(user, {
      bookId,
      eventName: "book_status_changed",
      properties: { from: previous?.readingStatus ?? "not_started", to: "reading" },
    });
  }

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
  const [previous] = await db.select().from(readerSettingsTable).where(and(eq(readerSettingsTable.userId, user.id), eq(readerSettingsTable.deviceMode, deviceMode)));

  await db
    .insert(readerSettingsTable)
    .values({ userId: user.id, deviceMode, ...normalized })
    .onConflictDoUpdate({
      target: [readerSettingsTable.userId, readerSettingsTable.deviceMode],
      set: {
        ...normalized,
      },
    });

  const fallback = normalizeReaderSettings({}, deviceMode);
  const prior = previous ?? fallback;
  const changedSettings = [
    ["font_size", prior.fontSize, normalized.fontSize],
    ["font_family", prior.fontFamily, normalized.fontFamily],
    ["line_height", prior.lineHeight, normalized.lineHeight],
    ["theme", prior.theme, normalized.theme],
    ["content_width", prior.contentWidth, normalized.contentWidth],
  ] as const;
  await Promise.all(changedSettings
    .filter(([, before, after]) => before !== after)
    .map(([setting, , value]) => recordServerAnalyticsEvent(user, {
      eventName: "reader_setting_changed",
      deviceMode,
      properties: { setting, valueBucket: readerSettingValueBucket(setting, value), deviceMode },
    })));

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

// GET /books/:id/bookmarks
router.get("/books/:id/bookmarks", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const [book] = await db.select({ id: booksTable.id, contentBookId: booksTable.contentBookId, cycleId: booksTable.cycleId, title: booksTable.title }).from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const cycleBooks = await listCycleBooks(user.id, book.cycleId, book.id, book.title);
  const titlesById = new Map(cycleBooks.map((b) => [b.id, b.title]));
  const rows = cycleBooks.length > 1
    ? await db.select().from(bookmarksTable).where(and(eq(bookmarksTable.userId, user.id), inArray(bookmarksTable.bookId, cycleBooks.map((b) => b.id)))).orderBy(bookmarksTable.createdAt)
    : await db.select().from(bookmarksTable).where(and(eq(bookmarksTable.userId, user.id), eq(bookmarksTable.bookId, bookId))).orderBy(bookmarksTable.createdAt);
  res.json(rows.map((row) => ({ ...row, bookTitle: titlesById.get(row.bookId) ?? null })));
});

// POST /books/:id/bookmarks
router.post("/books/:id/bookmarks", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const [book] = await db.select({ id: booksTable.id, contentBookId: booksTable.contentBookId }).from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const { chapterId, positionRaw, label, selectedText } = req.body ?? {};
  if (typeof chapterId !== "number" || !Number.isInteger(chapterId)) { res.status(400).json({ error: "chapterId обязателен" }); return; }
  if (typeof positionRaw !== "string" || !positionRaw.trim()) { res.status(400).json({ error: "positionRaw обязателен" }); return; }
  if (positionRaw.length > 8000) { res.status(400).json({ error: "positionRaw слишком длинный" }); return; }
  const normalizedLabel = typeof label === "string" ? label.trim().slice(0, 200) || null : null;
  const normalizedSelectedText = typeof selectedText === "string" ? selectedText.trim().slice(0, 100) || null : null;
  const [chapter] = await db.select({ id: chaptersTable.id }).from(chaptersTable).where(and(eq(chaptersTable.id, chapterId), eq(chaptersTable.bookId, getContentBookId(book))));
  if (!chapter) { res.status(400).json({ error: "Глава не найдена" }); return; }
  const [row] = await db.insert(bookmarksTable).values({ userId: user.id, bookId, chapterId, positionRaw: positionRaw.trim(), label: normalizedLabel, selectedText: normalizedSelectedText }).returning();
  res.status(201).json(row);
});

// DELETE /books/:id/bookmarks/:bookmarkId
router.delete("/books/:id/bookmarks/:bookmarkId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const bookmarkId = String(req.params.bookmarkId);
  const [book] = await db.select({ id: booksTable.id, cycleId: booksTable.cycleId }).from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const [existing] = await db.select({ bookId: bookmarksTable.bookId }).from(bookmarksTable).where(and(eq(bookmarksTable.id, bookmarkId), eq(bookmarksTable.userId, user.id)));
  if (!existing) { res.status(404).json({ error: "Закладка не найдена" }); return; }
  const allowed = existing.bookId === bookId || (await bookInSameCycle(user.id, book.cycleId, existing.bookId));
  if (!allowed) { res.status(404).json({ error: "Закладка не найдена" }); return; }
  const [deleted] = await db.delete(bookmarksTable).where(and(eq(bookmarksTable.id, bookmarkId), eq(bookmarksTable.userId, user.id))).returning({ id: bookmarksTable.id });
  if (!deleted) { res.status(404).json({ error: "Закладка не найдена" }); return; }
  res.json({ id: deleted.id });
});

// GET /books/:id/notes
router.get("/books/:id/notes", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const [book] = await db.select({ id: booksTable.id, contentBookId: booksTable.contentBookId, cycleId: booksTable.cycleId, title: booksTable.title }).from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const cycleBooks = await listCycleBooks(user.id, book.cycleId, book.id, book.title);
  const titlesById = new Map(cycleBooks.map((b) => [b.id, b.title]));
  const rows = cycleBooks.length > 1
    ? await db.select().from(notesTable).where(and(eq(notesTable.userId, user.id), inArray(notesTable.bookId, cycleBooks.map((b) => b.id)))).orderBy(notesTable.updatedAt)
    : await db.select().from(notesTable).where(and(eq(notesTable.userId, user.id), eq(notesTable.bookId, bookId))).orderBy(notesTable.updatedAt);
  res.json(rows.map((row) => ({ ...row, bookTitle: titlesById.get(row.bookId) ?? null })));
});

// POST /books/:id/notes
router.post("/books/:id/notes", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const [book] = await db.select({ id: booksTable.id, contentBookId: booksTable.contentBookId }).from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const { chapterId, positionRaw, highlightedText, noteText, color } = req.body ?? {};
  if (typeof chapterId !== "number" || !Number.isInteger(chapterId)) { res.status(400).json({ error: "chapterId обязателен" }); return; }
  if (typeof positionRaw !== "string" || !positionRaw.trim()) { res.status(400).json({ error: "positionRaw обязателен" }); return; }
  if (positionRaw.length > 8000) { res.status(400).json({ error: "positionRaw слишком длинный" }); return; }
  if (typeof noteText !== "string" || !noteText.trim()) { res.status(400).json({ error: "noteText обязателен" }); return; }
  if (noteText.length > 2000) { res.status(400).json({ error: "noteText слишком длинный" }); return; }
  const normalizedHighlightedText = typeof highlightedText === "string" ? highlightedText.trim().slice(0, 100) || null : null;
  const normalizedColor = ["yellow", "green", "blue", "pink", "purple"].includes(color) ? color : "yellow";
  const [chapter] = await db.select({ id: chaptersTable.id }).from(chaptersTable).where(and(eq(chaptersTable.id, chapterId), eq(chaptersTable.bookId, getContentBookId(book))));
  if (!chapter) { res.status(400).json({ error: "Глава не найдена" }); return; }
  const [row] = await db.insert(notesTable).values({ userId: user.id, bookId, chapterId, positionRaw: positionRaw.trim(), highlightedText: normalizedHighlightedText, noteText: noteText.trim().slice(0, 2000), color: normalizedColor }).returning();
  res.status(201).json(row);
});

// PUT /books/:id/notes/:noteId
router.put("/books/:id/notes/:noteId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const noteId = String(req.params.noteId);
  const [book] = await db.select({ id: booksTable.id, cycleId: booksTable.cycleId }).from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const [existing] = await db.select({ bookId: notesTable.bookId }).from(notesTable).where(and(eq(notesTable.id, noteId), eq(notesTable.userId, user.id)));
  if (!existing) { res.status(404).json({ error: "Заметка не найдена" }); return; }
  const allowed = existing.bookId === bookId || (await bookInSameCycle(user.id, book.cycleId, existing.bookId));
  if (!allowed) { res.status(404).json({ error: "Заметка не найдена" }); return; }
  const { noteText, color } = req.body ?? {};
  if (noteText && (typeof noteText !== "string" || noteText.length > 2000)) { res.status(400).json({ error: "noteText некорректен" }); return; }
  const normalizedColor = color && ["yellow", "green", "blue", "pink", "purple"].includes(color) ? color : undefined;
  const updateData: Record<string, unknown> = { updatedAt: new Date() };
  if (noteText) updateData.noteText = noteText.trim().slice(0, 2000);
  if (normalizedColor) updateData.color = normalizedColor;
  const [row] = await db.update(notesTable).set(updateData).where(and(eq(notesTable.id, noteId), eq(notesTable.userId, user.id))).returning();
  if (!row) { res.status(404).json({ error: "Заметка не найдена" }); return; }
  res.json(row);
});

// DELETE /books/:id/notes/:noteId
router.delete("/books/:id/notes/:noteId", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseInt(String(req.params.id), 10);
  const noteId = String(req.params.noteId);
  const [book] = await db.select({ id: booksTable.id, cycleId: booksTable.cycleId }).from(booksTable).where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  const [existing] = await db.select({ bookId: notesTable.bookId }).from(notesTable).where(and(eq(notesTable.id, noteId), eq(notesTable.userId, user.id)));
  if (!existing) { res.status(404).json({ error: "Заметка не найдена" }); return; }
  const allowed = existing.bookId === bookId || (await bookInSameCycle(user.id, book.cycleId, existing.bookId));
  if (!allowed) { res.status(404).json({ error: "Заметка не найдена" }); return; }
  const [deleted] = await db.delete(notesTable).where(and(eq(notesTable.id, noteId), eq(notesTable.userId, user.id))).returning({ id: notesTable.id });
  if (!deleted) { res.status(404).json({ error: "Заметка не найдена" }); return; }
  res.json({ id: deleted.id });
});

export default router;
