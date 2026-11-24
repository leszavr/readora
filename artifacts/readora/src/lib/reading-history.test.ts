import assert from "node:assert/strict";
import test from "node:test";
import type { ReadingHistoryEntry } from "@workspace/api-client-react";
import {
  HISTORY_DELETE_BATCH_SIZE,
  formatHistoryDate,
  formatHistoryMonthLabel,
  groupHistoryEntries,
  planHistoryDeletion,
} from "./reading-history";

const NOVEMBER = new Date(2026, 10, 15, 12, 0).toISOString();
const DECEMBER = new Date(2026, 11, 3, 9, 0).toISOString();

function entry(partial: Partial<ReadingHistoryEntry> = {}): ReadingHistoryEntry {
  return {
    id: 1,
    bookId: 1,
    title: "Книга",
    author: "Автор",
    coverUrl: null,
    cycleName: null,
    genreName: null,
    completedAt: NOVEMBER,
    comment: null,
    ...partial,
  };
}

const labels = (grouped: { label: string; items: ReadingHistoryEntry[] }[]) =>
  grouped.map((group) => [group.label, group.items.map((item) => item.id)]);

test("без группировки группы не строются", () => {
  assert.deepEqual(groupHistoryEntries([entry()], "none"), []);
  assert.deepEqual(groupHistoryEntries([], "author"), []);
});

test("группировка объединяет только подряд идущие записи", () => {
  const grouped = groupHistoryEntries([
    entry({ id: 1, author: "Толстой" }),
    entry({ id: 2, author: "Толстой" }),
    entry({ id: 3, author: "Достоевский" }),
    entry({ id: 4, author: "Толстой" }),
  ], "author");
  assert.deepEqual(labels(grouped), [["Толстой", [1, 2]], ["Достоевский", [3]], ["Толстой", [4]]]);
});

test("записи без автора, жанра и цикла попадают в именованные группы в конце порядка", () => {
  assert.deepEqual(labels(groupHistoryEntries([entry({ id: 1 }), entry({ id: 2, author: null })], "author")), [
    ["Автор", [1]],
    ["Неизвестный автор", [2]],
  ]);
  assert.deepEqual(labels(groupHistoryEntries([entry({ id: 1, genreName: "Детектив" }), entry({ id: 2, genreName: null })], "genre")), [
    ["Детектив", [1]],
    ["Без жанра", [2]],
  ]);
  assert.deepEqual(labels(groupHistoryEntries([entry({ id: 1, cycleName: null }), entry({ id: 2, cycleName: "Цикл" })], "cycle")), [
    ["Вне цикла", [1]],
    ["Цикл", [2]],
  ]);
});

test("группировка по месяцу объединяет записи одного месяца и делит разные", () => {
  const grouped = groupHistoryEntries([
    entry({ id: 1, completedAt: DECEMBER }),
    entry({ id: 2, completedAt: new Date(2026, 11, 20, 18, 0).toISOString() }),
    entry({ id: 3, completedAt: NOVEMBER }),
  ], "date");
  assert.deepEqual(labels(grouped), [["Декабрь 2026", [1, 2]], ["Ноябрь 2026", [3]]]);
});

test("месяц и дата определяются по локальному времени пользователя", () => {
  const justAfterLocalMidnight = new Date(2026, 10, 1, 0, 15).toISOString();
  assert.equal(formatHistoryMonthLabel(justAfterLocalMidnight), "Ноябрь 2026");
  assert.equal(formatHistoryDate(justAfterLocalMidnight), "01.11.2026");
  assert.equal(formatHistoryMonthLabel(new Date(2026, 0, 20).toISOString()), "Январь 2026");
});

test("некорректная дата не ломает вывод", () => {
  assert.equal(formatHistoryMonthLabel("не дата"), "");
  assert.equal(formatHistoryDate("не дата"), "");
});

test("размер батча удаления — 500", () => {
  assert.equal(HISTORY_DELETE_BATCH_SIZE, 500);
});

test("ничего не выбрано — удалять нечего", () => {
  assert.deepEqual(planHistoryDeletion([], 5), { mode: "bulk", batches: [] });
});

test("часть выбора удаляется одним батчем", () => {
  assert.deepEqual(planHistoryDeletion([3, 1, 2], 5), { mode: "bulk", batches: [[3, 1, 2]] });
});

test("большой выбор делится на батчи по 500", () => {
  const ids = Array.from({ length: 1200 }, (_, index) => index + 1);
  const plan = planHistoryDeletion(ids, 5000);
  assert.equal(plan.mode, "bulk");
  assert.deepEqual(plan.mode === "bulk" ? plan.batches.map((batch) => batch.length) : [], [500, 500, 200]);
});

test("выбрана вся история — очищается одним запросом", () => {
  assert.deepEqual(planHistoryDeletion([2, 1], 2), { mode: "clear" });
  assert.deepEqual(planHistoryDeletion([7], 1), { mode: "clear" });
});

test("выбор размером с историю, но при пустой истории — не очистка", () => {
  assert.deepEqual(planHistoryDeletion([], 0), { mode: "bulk", batches: [] });
});
