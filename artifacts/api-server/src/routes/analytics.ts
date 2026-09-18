import { Router, type Request } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod/v4";
import { analyticsEventsTable, booksTable, db, type usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";

const router = Router();
type AuthReq = Request & { user: typeof usersTable.$inferSelect };

const uuid = z.string().uuid();
const percentage = z.number().finite().min(0).max(100);
const durationMs = z.number().int().min(0).max(24 * 60 * 60 * 1000);
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  (value) => new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value,
  "Некорректная локальная дата события",
);
const analyticsEventBaseSchema = z.object({
  eventId: uuid,
  occurredAt: z.string().datetime({ offset: true }),
  localDate,
  sessionId: uuid.optional(),
  clientId: uuid,
  platform: z.literal("web"),
  deviceMode: z.enum(["desktop", "mobile", "unknown"]),
  appVersion: z.string().max(64).optional(),
  bookId: z.number().int().positive().optional(),
});

const clientEventSchema = z.discriminatedUnion("eventName", [
  analyticsEventBaseSchema.extend({ eventName: z.literal("app_opened"), properties: z.object({ entryPoint: z.enum(["library", "reader", "book", "profile"]) }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("library_viewed"), properties: z.object({ viewMode: z.enum(["grid", "list", "shelf"]), filterCount: z.number().int().min(0).max(20), hasSearch: z.boolean() }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("book_upload_started"), properties: z.object({ format: z.enum(["fb2", "epub"]), fileSizeBucket: z.enum(["under_1mb", "1_to_5mb", "5_to_20mb", "20_to_50mb"]) }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("reader_session_started"), properties: z.object({ startProgressPct: percentage }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("reader_session_ended"), properties: z.object({ startProgressPct: percentage, endProgressPct: percentage, maxProgressPct: percentage, activeReadingMs: durationMs, endReason: z.enum(["hidden", "unmount", "inactive"]) }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("reading_progressed"), properties: z.object({ chapterIndex: z.number().int().min(0).max(100000), progressPct: percentage, intervalActiveMs: durationMs }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("chapter_opened"), properties: z.object({ chapterIndex: z.number().int().min(0).max(100000), navigationSource: z.enum(["toc", "next_chapter", "prev_chapter", "restore"]) }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("progress_sync_finished"), properties: z.object({ outcome: z.enum(["success", "error"]), durationMs }).strict() }).strict(),
]);

const batchSchema = z.object({
  events: z.array(clientEventSchema).min(1).max(50),
}).strict();

router.post("/analytics/events/batch", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!user.analyticsOptIn) {
    res.sendStatus(204);
    return;
  }

  const payloadSize = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
  if (payloadSize > 64 * 1024) {
    res.status(413).json({ error: "Пакет аналитики превышает 64 КБ" });
    return;
  }

  const parsed = batchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Некорректный пакет аналитики" });
    return;
  }

  const now = Date.now();
  const rejectedEventIds = parsed.data.events
    .filter((event) => Date.parse(event.occurredAt) > now + 5 * 60 * 1000)
    .map((event) => event.eventId);
  const candidateEvents = parsed.data.events.filter((event) => !rejectedEventIds.includes(event.eventId));
  const bookIds = [...new Set(candidateEvents.flatMap((event) => event.bookId === undefined ? [] : [event.bookId]))];
  const ownedBookIds = new Set(
    bookIds.length === 0
      ? []
      : (await db.select({ id: booksTable.id }).from(booksTable).where(and(eq(booksTable.ownerUserId, user.id), inArray(booksTable.id, bookIds)))).map((book) => book.id),
  );
  const acceptedEvents = candidateEvents.filter((event) => {
    if (event.bookId !== undefined && !ownedBookIds.has(event.bookId)) {
      rejectedEventIds.push(event.eventId);
      return false;
    }
    return true;
  });

  if (acceptedEvents.length > 0) {
    await db.insert(analyticsEventsTable).values(acceptedEvents.map((event) => ({
      eventId: event.eventId,
      userId: user.id,
      bookId: event.bookId,
      eventName: event.eventName,
      producer: "client",
      occurredAt: new Date(event.occurredAt),
      occurredLocalDate: event.localDate,
      clientId: event.clientId,
      sessionId: event.sessionId,
      platform: event.platform,
      deviceMode: event.deviceMode,
      appVersion: event.appVersion,
      properties: event.properties,
    }))).onConflictDoNothing({ target: analyticsEventsTable.eventId });
  }

  res.json({ acceptedEventIds: acceptedEvents.map((event) => event.eventId), rejectedEventIds });
});

export default router;
