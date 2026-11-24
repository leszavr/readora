import assert from "node:assert/strict";
import test from "node:test";
import {
  READING_HISTORY_COMMENT_MAX_LENGTH,
  normalizeReadingHistoryComment,
  parseReadingHistoryListQuery,
  resolveReadingHistorySort,
} from "../src/lib/reading-history";

test("лимит комментария — 255 символов", () => {
  assert.equal(READING_HISTORY_COMMENT_MAX_LENGTH, 255);
});

test("комментарий обрезается по краям и сохраняется", () => {
  const result = normalizeReadingHistoryComment("  Отличная книга  ");
  assert.deepEqual(result, { valid: true, comment: "Отличная книга" });
});

test("пустой комментарий и null очищают комментарий", () => {
  for (const value of [null, undefined, "", "   "]) {
    assert.deepEqual(normalizeReadingHistoryComment(value), { valid: true, comment: null });
  }
});

test("комментарий ровно в 255 символов принимается", () => {
  const result = normalizeReadingHistoryComment("а".repeat(255));
  assert.deepEqual(result, { valid: true, comment: "а".repeat(255) });
});

test("комментарий длиннее 255 символов отклоняется", () => {
  const result = normalizeReadingHistoryComment("а".repeat(256));
  assert.equal(result.valid, false);
});

test("пробелы по краям не расходуют лимит", () => {
  const result = normalizeReadingHistoryComment(`  ${"а".repeat(255)}  `);
  assert.deepEqual(result, { valid: true, comment: "а".repeat(255) });
});

test("не-строка отклоняется как комментарий", () => {
  for (const value of [42, {}, [], true]) {
    const result = normalizeReadingHistoryComment(value);
    assert.equal(result.valid, false, `ожидалось отклонение для ${JSON.stringify(value)}`);
  }
});

test("параметры списка по умолчанию: по дате завершения, новые сверху, без группировки", () => {
  assert.deepEqual(parseReadingHistoryListQuery({}), {
    valid: true,
    params: { search: undefined, sortBy: "completedAt", sortDir: "desc", groupBy: "none" },
  });
});

test("параметры списка принимают перечисленные значения и обрезают поиск", () => {
  assert.deepEqual(parseReadingHistoryListQuery({ search: "  пушкин ", sortBy: "author", sortDir: "asc", groupBy: "cycle" }), {
    valid: true,
    params: { search: "пушкин", sortBy: "author", sortDir: "asc", groupBy: "cycle" },
  });
});

test("поиск из одних пробелов равнозначен отсутствию поиска", () => {
  assert.deepEqual(parseReadingHistoryListQuery({ search: "   " }), {
    valid: true,
    params: { search: undefined, sortBy: "completedAt", sortDir: "desc", groupBy: "none" },
  });
});

test("неизвестные значения параметров отклоняются", () => {
  for (const query of [{ sortBy: "uploadedAt" }, { sortDir: "sideways" }, { groupBy: "status" }, { search: ["a", "b"] }]) {
    assert.equal(parseReadingHistoryListQuery(query).valid, false, `ожидалось отклонение для ${JSON.stringify(query)}`);
  }
});

test("без группировки сортируется только выбранным полем", () => {
  assert.deepEqual(resolveReadingHistorySort({ sortBy: "title", sortDir: "asc", groupBy: "none" }), [
    { field: "title", dir: "asc" },
  ]);
});

test("по умолчанию — сначала недавние", () => {
  assert.deepEqual(resolveReadingHistorySort({ sortBy: "completedAt", sortDir: "desc", groupBy: "none" }), [
    { field: "completedAt", dir: "desc" },
  ]);
});

test("группировка по месяцам сортирует по дате завершения в выбранном направлении", () => {
  assert.deepEqual(resolveReadingHistorySort({ sortBy: "completedAt", sortDir: "asc", groupBy: "date" }), [
    { field: "completedAt", dir: "asc" },
  ]);
  assert.deepEqual(resolveReadingHistorySort({ sortBy: "title", sortDir: "desc", groupBy: "date" }), [
    { field: "completedAt", dir: "desc" },
    { field: "title", dir: "desc" },
  ]);
});

test("группировка по автору, жанру и циклу ставит ключ группы первым", () => {
  for (const groupBy of ["author", "genre", "cycle"] as const) {
    assert.deepEqual(
      resolveReadingHistorySort({ sortBy: "completedAt", sortDir: "desc", groupBy }),
      [{ field: groupBy, dir: "asc" }, { field: "completedAt", dir: "desc" }],
      `группировка ${groupBy}`,
    );
  }
});

test("если поле сортировки совпадает с группировкой, ключ не дублируется", () => {
  assert.deepEqual(resolveReadingHistorySort({ sortBy: "author", sortDir: "desc", groupBy: "author" }), [
    { field: "author", dir: "desc" },
  ]);
});
