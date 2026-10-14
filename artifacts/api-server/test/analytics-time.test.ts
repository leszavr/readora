import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_ANALYTICS_EVENT_AGE_MS,
  MAX_ANALYTICS_FUTURE_DRIFT_MS,
  getUtcDate,
  isAnalyticsEventTimestampAllowed,
} from "../src/lib/analytics-time";

const NOW = Date.UTC(2026, 9, 14, 12, 0, 0);

test("допускает события только в ограниченном временном окне", () => {
  assert.equal(isAnalyticsEventTimestampAllowed(new Date(NOW - MAX_ANALYTICS_EVENT_AGE_MS), NOW), true);
  assert.equal(isAnalyticsEventTimestampAllowed(new Date(NOW + MAX_ANALYTICS_FUTURE_DRIFT_MS), NOW), true);
  assert.equal(isAnalyticsEventTimestampAllowed(new Date(NOW - MAX_ANALYTICS_EVENT_AGE_MS - 1), NOW), false);
  assert.equal(isAnalyticsEventTimestampAllowed(new Date(NOW + MAX_ANALYTICS_FUTURE_DRIFT_MS + 1), NOW), false);
});

test("вычисляет день события в UTC", () => {
  assert.equal(getUtcDate(new Date("2026-10-14T00:30:00+10:00")), "2026-10-13");
});
