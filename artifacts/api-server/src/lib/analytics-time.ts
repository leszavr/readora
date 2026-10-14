export const MAX_ANALYTICS_EVENT_AGE_MS = 15 * 24 * 60 * 60 * 1000;
export const MAX_ANALYTICS_FUTURE_DRIFT_MS = 5 * 60 * 1000;

export function getUtcDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function isAnalyticsEventTimestampAllowed(
  occurredAt: Date,
  now = Date.now(),
): boolean {
  const timestamp = occurredAt.getTime();
  return timestamp >= now - MAX_ANALYTICS_EVENT_AGE_MS
    && timestamp <= now + MAX_ANALYTICS_FUTURE_DRIFT_MS;
}
