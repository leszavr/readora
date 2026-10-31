import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createProgressSaveHold,
  isProgressSaveHeld,
  trackProgressHoldScroll,
} from "./reader-progress-hold.ts";

describe("createProgressSaveHold", () => {
  it("создаёт hold без точки отсчёта и без накопления", () => {
    const hold = createProgressSaveHold(42);
    assert.equal(hold.chapterId, 42);
    assert.equal(hold.baselineScrollTop, null);
    assert.equal(hold.accumulatedScroll, 0);
  });
});

describe("isProgressSaveHeld", () => {
  it("активен только для главы прыжка", () => {
    const hold = createProgressSaveHold(7);
    assert.equal(isProgressSaveHeld(hold, 7), true);
    assert.equal(isProgressSaveHeld(hold, 8), false);
  });

  it("null-hold не блокирует ничего", () => {
    assert.equal(isProgressSaveHeld(null, 7), false);
    assert.equal(isProgressSaveHeld(null, null), false);
  });

  it("null-chapterId не блокируется", () => {
    const hold = createProgressSaveHold(7);
    assert.equal(isProgressSaveHeld(hold, null), false);
  });
});

describe("trackProgressHoldScroll", () => {
  const VIEWPORT = 800;

  it("программный скролл ребейзлит точку отсчёта без накопления", () => {
    const hold = createProgressSaveHold(1);
    // приземление через restore
    assert.equal(trackProgressHoldScroll(hold, 5000, VIEWPORT, true), false);
    assert.equal(hold.baselineScrollTop, 5000);
    assert.equal(hold.accumulatedScroll, 0);
    // поздняя highlight-подгонка — тоже программный скролл
    assert.equal(trackProgressHoldScroll(hold, 5150, VIEWPORT, true), false);
    assert.equal(hold.accumulatedScroll, 0);
    assert.equal(hold.baselineScrollTop, 5150);
  });

  it("первый пользовательский скролл без baseline только фиксирует точку отсчёта", () => {
    const hold = createProgressSaveHold(1);
    assert.equal(trackProgressHoldScroll(hold, 300, VIEWPORT, false), false);
    assert.equal(hold.baselineScrollTop, 300);
    assert.equal(hold.accumulatedScroll, 0);
  });

  it("мелкая подстройка вида не снимает hold", () => {
    const hold = createProgressSaveHold(1);
    trackProgressHoldScroll(hold, 1000, VIEWPORT, false); // baseline
    // пользователь крутит туда-сюда на четверть экрана
    assert.equal(trackProgressHoldScroll(hold, 1200, VIEWPORT, false), false);
    assert.equal(trackProgressHoldScroll(hold, 1000, VIEWPORT, false), false);
    assert.equal(trackProgressHoldScroll(hold, 1150, VIEWPORT, false), false);
    assert.equal(hold.accumulatedScroll, 200 + 200 + 150);
    assert.equal(hold.accumulatedScroll < VIEWPORT, true);
  });

  it("скролл на один экран снимает hold", () => {
    const hold = createProgressSaveHold(1);
    trackProgressHoldScroll(hold, 1000, VIEWPORT, false); // baseline
    assert.equal(trackProgressHoldScroll(hold, 1000 + VIEWPORT, VIEWPORT, false), true);
  });

  it("накопление считается по модулю дельты: скролл вверх тоже копится", () => {
    const hold = createProgressSaveHold(1);
    trackProgressHoldScroll(hold, 2000, VIEWPORT, false); // baseline
    assert.equal(trackProgressHoldScroll(hold, 1700, VIEWPORT, false), false); // 300
    assert.equal(trackProgressHoldScroll(hold, 2000, VIEWPORT, false), false); // +300 = 600
    assert.equal(hold.accumulatedScroll, 600);
    assert.equal(trackProgressHoldScroll(hold, 2300, VIEWPORT, false), true); // +300 = 900
  });

  it("программный скролл между пользовательскими не копит дельту", () => {
    const hold = createProgressSaveHold(1);
    trackProgressHoldScroll(hold, 1000, VIEWPORT, false); // baseline
    assert.equal(trackProgressHoldScroll(hold, 1300, VIEWPORT, false), false); // 300
    // реставрация позиции после перерисовки — программный скролл
    trackProgressHoldScroll(hold, 900, VIEWPORT, true); // ребейз, без накопления
    assert.equal(hold.accumulatedScroll, 300);
    assert.equal(trackProgressHoldScroll(hold, 1200, VIEWPORT, false), false); // +300 = 600
    assert.equal(hold.accumulatedScroll, 600);
  });

  it("порог устойчив к нулевому clientHeight", () => {
    const hold = createProgressSaveHold(1);
    trackProgressHoldScroll(hold, 100, 0, false); // baseline
    assert.equal(trackProgressHoldScroll(hold, 101, 0, false), true); // 1 >= max(1, 0)
  });
});
