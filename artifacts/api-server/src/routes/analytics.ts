import { Router, type Request } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { rateLimit } from "express-rate-limit";
import { z } from "zod/v4";
import { analyticsEventsTable, analyticsReaderSessionsTable, booksTable, db, type usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { getUtcDate, isAnalyticsEventTimestampAllowed } from "../lib/analytics-time";

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
const readerSessionEventBaseSchema = analyticsEventBaseSchema.extend({
  sessionId: uuid,
  bookId: z.number().int().positive(),
});

const clientEventSchema = z.discriminatedUnion("eventName", [
  analyticsEventBaseSchema.extend({ eventName: z.literal("app_opened"), properties: z.object({ entryPoint: z.enum(["library", "reader", "book", "profile"]) }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("library_viewed"), properties: z.object({ viewMode: z.enum(["grid", "list", "shelf"]), filterCount: z.number().int().min(0).max(20), hasSearch: z.boolean() }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("book_upload_started"), properties: z.object({ format: z.enum(["fb2", "epub"]), fileSizeBucket: z.enum(["under_1mb", "1_to_5mb", "5_to_20mb", "20_to_50mb"]) }).strict() }).strict(),
  readerSessionEventBaseSchema.extend({ eventName: z.literal("reader_session_started"), properties: z.object({ startProgressPct: percentage }).strict() }).strict(),
  readerSessionEventBaseSchema.extend({ eventName: z.literal("reader_session_heartbeat"), properties: z.object({ activeReadingMs: durationMs }).strict() }).strict(),
  readerSessionEventBaseSchema.extend({ eventName: z.literal("reader_session_ended"), properties: z.object({ startProgressPct: percentage, endProgressPct: percentage, maxProgressPct: percentage, activeReadingMs: durationMs, endReason: z.enum(["hidden", "unmount", "inactive"]) }).strict() }).strict(),
  readerSessionEventBaseSchema.extend({ eventName: z.literal("reading_progressed"), properties: z.object({ chapterIndex: z.number().int().min(0).max(100000), progressPct: percentage, intervalActiveMs: durationMs }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("chapter_opened"), properties: z.object({ chapterIndex: z.number().int().min(0).max(100000), navigationSource: z.enum(["toc", "next_chapter", "prev_chapter", "restore"]) }).strict() }).strict(),
  analyticsEventBaseSchema.extend({ eventName: z.literal("progress_sync_finished"), properties: z.object({ outcome: z.enum(["success", "error"]), durationMs }).strict() }).strict(),
]);

const batchSchema = z.object({
  events: z.array(clientEventSchema).min(1).max(50),
}).strict();
type ClientAnalyticsEvent = z.infer<typeof clientEventSchema>;
type ReaderSessionEvent = Extract<ClientAnalyticsEvent, {
  eventName: "reader_session_started" | "reader_session_heartbeat" | "reader_session_ended" | "reading_progressed";
}>;

const analyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const user = (req as AuthReq).user;
    return user ? `user:${user.id}` : `ip:${req.ip}`;
  },
  message: { error: "Слишком много событий аналитики. Попробуйте позже" },
});

function isReaderSessionEvent(event: ClientAnalyticsEvent): event is ReaderSessionEvent {
  return event.eventName === "reader_session_started"
    || event.eventName === "reader_session_heartbeat"
    || event.eventName === "reader_session_ended"
    || event.eventName === "reading_progressed";
}

router.post("/analytics/events/batch", requireAuth, analyticsLimiter, async (req, res): Promise<void> => {
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
    .filter((event) => !isAnalyticsEventTimestampAllowed(new Date(event.occurredAt), now))
    .map((event) => event.eventId);
  const candidateEvents = parsed.data.events.filter((event) => !rejectedEventIds.includes(event.eventId));
  const bookIds = [...new Set(candidateEvents.flatMap((event) => event.bookId === undefined ? [] : [event.bookId]))];
  const ownedBookIds = new Set(
    bookIds.length === 0
      ? []
      : (await db.select({ id: booksTable.id }).from(booksTable).where(and(eq(booksTable.ownerUserId, user.id), inArray(booksTable.id, bookIds)))).map((book) => book.id),
  );
  const ownedEvents = candidateEvents.filter((event) => {
    if (event.bookId !== undefined && !ownedBookIds.has(event.bookId)) {
      rejectedEventIds.push(event.eventId);
      return false;
    }
    return true;
  });

  const acceptedEvents: typeof ownedEvents = [];
  await db.transaction(async (tx) => {
    for (const event of ownedEvents) {
      const occurredAt = new Date(event.occurredAt);
      if (isReaderSessionEvent(event)) {
        const [storedSession] = await tx
          .select({ userId: analyticsReaderSessionsTable.userId, bookId: analyticsReaderSessionsTable.bookId, endedAt: analyticsReaderSessionsTable.endedAt })
          .from(analyticsReaderSessionsTable)
          .where(eq(analyticsReaderSessionsTable.sessionId, event.sessionId));

        if (event.eventName === "reader_session_started") {
          if (storedSession && (storedSession.userId !== user.id || storedSession.bookId !== event.bookId)) {
            rejectedEventIds.push(event.eventId);
            continue;
          }
          if (!storedSession) {
            await tx.insert(analyticsReaderSessionsTable).values({
              sessionId: event.sessionId,
              userId: user.id,
              bookId: event.bookId,
              deviceMode: event.deviceMode,
              startedAt: occurredAt,
              lastSeenAt: occurredAt,
            });
          }
        } else {
          if (!storedSession || storedSession.userId !== user.id || storedSession.bookId !== event.bookId || storedSession.endedAt) {
            rejectedEventIds.push(event.eventId);
            continue;
          }

          const activeReadingMs = event.eventName === "reading_progressed"
            ? event.properties.intervalActiveMs
            : event.properties.activeReadingMs;
          await tx
            .update(analyticsReaderSessionsTable)
            .set({
              lastSeenAt: sql`greatest(${analyticsReaderSessionsTable.lastSeenAt}, ${occurredAt})`,
              activeReadingMs: sql`greatest(${analyticsReaderSessionsTable.activeReadingMs}, ${activeReadingMs})`,
              ...(event.eventName === "reader_session_ended" ? { endedAt: occurredAt } : {}),
            })
            .where(eq(analyticsReaderSessionsTable.sessionId, event.sessionId));
        }
      }

      await tx.insert(analyticsEventsTable).values({
        eventId: event.eventId,
        userId: user.id,
        bookId: event.bookId,
        eventName: event.eventName,
        producer: "client",
        occurredAt,
        eventDay: getUtcDate(occurredAt),
        occurredLocalDate: event.localDate,
        clientId: event.clientId,
        sessionId: event.sessionId,
        platform: event.platform,
        deviceMode: event.deviceMode,
        appVersion: event.appVersion,
        properties: event.properties,
      }).onConflictDoNothing({ target: analyticsEventsTable.eventId });
      acceptedEvents.push(event);
    }
  });

  res.json({ acceptedEventIds: acceptedEvents.map((event) => event.eventId), rejectedEventIds });
});

export default router;
