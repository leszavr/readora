// Hold сохранения прогресса после перехода по заметке/закладке.
//
// Переход по заметке/закладке не должен перезаписывать сохранённую позицию
// чтения: пользователь может просто просмотреть контекст, не продолжая
// чтение. Пока hold активен, сохранение позиции для главы прыжка
// подавляется. Hold снимается, когда пользователь демонстрирует
// продолжение чтения: накопил скролл в объём одного экрана или перешёл
// на другую главу обычной навигацией (не через заметку/закладку).

export interface ProgressSaveHold {
  chapterId: number;
  /** scrollTop точки приземления; null, пока первый скролл не наблюдался */
  baselineScrollTop: number | null;
  /** накопленный пользовательский скролл от точки приземления, px */
  accumulatedScroll: number;
}

export function createProgressSaveHold(chapterId: number): ProgressSaveHold {
  return { chapterId, baselineScrollTop: null, accumulatedScroll: 0 };
}

/** Hold активен только для главы, в которую приземлился прыжок */
export function isProgressSaveHeld(
  hold: ProgressSaveHold | null,
  chapterId: number | null,
): boolean {
  return hold !== null && chapterId !== null && hold.chapterId === chapterId;
}

/**
 * Обрабатывает scroll-событие для активного hold.
 * Программный скролл (restore позиции, highlight) только ребейзлит точку
 * отсчёта; пользовательский — накапливается по модулю дельты.
 * Возвращает true, когда накопленный скролл достиг порога снятия
 * (один экран) — чтение продолжается, hold снимается.
 */
export function trackProgressHoldScroll(
  hold: ProgressSaveHold,
  scrollTop: number,
  clientHeight: number,
  isProgrammatic: boolean,
): boolean {
  if (isProgrammatic) {
    hold.baselineScrollTop = scrollTop;
    return false;
  }

  if (hold.baselineScrollTop === null) {
    // Первый наблюдаемый скролл — принимаем за точку приземления.
    // Обычно это программный restore, не покрытый guard-ом.
    hold.baselineScrollTop = scrollTop;
    return false;
  }

  hold.accumulatedScroll += Math.abs(scrollTop - hold.baselineScrollTop);
  hold.baselineScrollTop = scrollTop;
  return hold.accumulatedScroll >= Math.max(1, clientHeight);
}
