import crypto from "node:crypto";
import { analyticsEventsTable, db, type User } from "@workspace/db";

type ServerAnalyticsEvent = {
  bookId?: number;
  eventName: "book_upload_finished" | "book_added" | "book_status_changed" | "book_completed" | "reader_setting_changed";
  occurredAt?: Date;
  deviceMode?: "desktop" | "mobile" | "unknown";
  properties: Record<string, string | number>;
};

export async function recordServerAnalyticsEvent(
  user: Pick<User, "id" | "analyticsOptIn">,
  event: ServerAnalyticsEvent,
): Promise<void> {
  if (!user.analyticsOptIn) return;

  const occurredAt = event.occurredAt ?? new Date();
  await db.insert(analyticsEventsTable).values({
    eventId: crypto.randomUUID(),
    userId: user.id,
    bookId: event.bookId,
    eventName: event.eventName,
    producer: "server",
    occurredAt,
    occurredLocalDate: occurredAt.toISOString().slice(0, 10),
    platform: "web",
    deviceMode: event.deviceMode ?? "unknown",
    properties: event.properties,
  }).catch(() => undefined);
}
