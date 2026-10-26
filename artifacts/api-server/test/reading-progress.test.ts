import assert from "node:assert/strict";
import test from "node:test";
import { resolveProgressUpdate } from "../src/lib/reading-progress";

const NOW = new Date("2026-10-26T20:00:00Z");
const COMPLETED_AT = new Date("2026-09-01T10:00:00Z");

test("новая книга получает присланный статус и процент", () => {
  const result = resolveProgressUpdate(null, { progressPercent: 12, readingStatus: "reading" }, NOW);
  assert.deepEqual(result, { readingStatus: "reading", progressPercent: 12, completedAt: null });
});

test("прочитанная книга не откатывается в «читаю» при повторном открытии", () => {
  const result = resolveProgressUpdate(
    { readingStatus: "finished", progressPercent: 100, completedAt: COMPLETED_AT },
    { progressPercent: 42, readingStatus: "reading" },
    NOW,
  );
  assert.equal(result.readingStatus, "finished");
  assert.equal(result.progressPercent, 100);
  assert.equal(result.completedAt, COMPLETED_AT);
});

test("процент прочитанной книги не уменьшается", () => {
  const result = resolveProgressUpdate(
    { readingStatus: "finished", progressPercent: 97, completedAt: null },
    { progressPercent: 10, readingStatus: "reading" },
    NOW,
  );
  assert.equal(result.progressPercent, 97);
  assert.equal(result.completedAt, NOW);
});

test("завершение книги фиксирует completedAt", () => {
  const result = resolveProgressUpdate(
    { readingStatus: "reading", progressPercent: 99, completedAt: null },
    { progressPercent: 100, readingStatus: "finished" },
    NOW,
  );
  assert.deepEqual(result, { readingStatus: "finished", progressPercent: 100, completedAt: NOW });
});
