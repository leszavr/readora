// Adapted from voxlibris reader-progress-core.ts
// Key difference: uses chapterId (DB id) + chapterIndex (0-based) instead of
// 1-based currentChapter; progress field is named progressPercent.
//
// UPDATE: Добавлена поддержка семантического позиционирования (v2) через
// reader-text-anchor.ts. Legacy формат (v1) сохраняется для обратной совместимости.

import {
  type SemanticReadingPosition,
  type LegacyReadingPosition,
  serializeSemanticPosition,
  parseReadingPosition,
} from "./reader-text-anchor";

// Re-export типы для обратной совместимости
export type { SemanticReadingPosition, LegacyReadingPosition };

/**
 * Legacy позиция чтения (v1) — пиксельная, с глобальным textOffset
 * @deprecated Используйте SemanticReadingPosition (v2)
 */
export interface ReaderPositionPayload {
  chapterId?: number;
  scrollTop: number;
  scrollHeight?: number;
  clientHeight?: number;
  timestamp?: number;
  textOffset?: number;
}

/**
 * Параметры для создания прогресса чтения
 * Поддерживает как legacy (v1), так и semantic (v2) позиции
 */
export interface ReaderProgressPayload {
  currentChapterId: number;
  /** 
   * Сериализованная позиция чтения.
   * v2: SemanticReadingPosition (JSON с version: 2)
   * v1: LegacyReadingPosition (JSON с scrollTop)
   */
  currentPosition: string;
  progressPercent: number;
}

export interface ReaderProgressSnapshot {
  currentChapterId: number;
  currentPosition: string;
  progressPercent: number;
}

/**
 * Входные параметры для создания прогресса (legacy v1)
 * @deprecated Используйте createSemanticProgressPayload с SemanticReadingPosition
 */
export interface ReaderProgressBuildInput {
  chapterId: number;
  chapterIndex: number;   // 0-based
  totalChapters: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  progressOverride?: number;
  timestamp?: number;
  textOffset?: number;
}

/**
 * Входные параметры для создания семантического прогресса (v2)
 */
export interface SemanticProgressBuildInput {
  chapterId: number;
  chapterIndex: number;
  totalChapters: number;
  /** Семантическая позиция из reader-text-anchor.ts */
  semanticPosition: SemanticReadingPosition;
  /** Опциональный override процента прогресса */
  progressOverride?: number;
}

/**
 * Сериализует позицию чтения в строку.
 * Поддерживает как legacy (v1), так и semantic (v2) форматы.
 */
export function serializeReaderPosition(
  position: ReaderPositionPayload | SemanticReadingPosition
): string {
  // Если это семантическая позиция (v2), используем её сериализацию
  if ("version" in position && position.version === 2) {
    return serializeSemanticPosition(position as SemanticReadingPosition);
  }
  // Legacy формат (v1)
  return JSON.stringify(position);
}

/**
 * Парсит строку позиции чтения.
 * Пытается распарсить как semantic (v2), затем как legacy (v1).
 */
export function parseReaderPosition(
  raw: string | null | undefined
): ReaderPositionPayload | SemanticReadingPosition | null {
  if (!raw) return null;

  // Сначала пробуем распарсить как семантическую позицию (v2)
  const semantic = parseReadingPosition(raw);
  if (semantic) {
    return semantic;
  }

  // Fallback к legacy формату (v1)
  try {
    const parsed = JSON.parse(raw) as Partial<ReaderPositionPayload>;
    if (typeof parsed !== "object" || parsed === null) return null;
    if (typeof parsed.scrollTop !== "number") return null;

    return {
      chapterId: typeof parsed.chapterId === "number" ? parsed.chapterId : undefined,
      scrollTop: parsed.scrollTop,
      scrollHeight: typeof parsed.scrollHeight === "number" ? parsed.scrollHeight : undefined,
      clientHeight: typeof parsed.clientHeight === "number" ? parsed.clientHeight : undefined,
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : undefined,
      textOffset: typeof parsed.textOffset === "number" ? parsed.textOffset : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Type guard для проверки, является ли позиция семантической (v2)
 */
export function isSemanticPosition(
  position: ReaderPositionPayload | SemanticReadingPosition | null
): position is SemanticReadingPosition {
  return (
    position !== null &&
    "version" in position &&
    position.version === 2
  );
}

/**
 * Проверяет, можно ли восстановить позицию для данной главы.
 * Работает с обоими форматами: legacy (v1) и semantic (v2).
 */
export function canRestorePositionForChapter(
  position: ReaderPositionPayload | SemanticReadingPosition | null,
  currentChapterId: number
): boolean {
  if (!position) return false;
  if (typeof position.chapterId !== "number") {
    return true;
  }
  return position.chapterId === currentChapterId;
}

export function calculateReadingProgress(
  chapterIndex: number,   // 0-based
  totalChapters: number,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): number {
  const safeTotalChapters = Math.max(1, totalChapters);
  const maxScrollable = Math.max(1, scrollHeight - clientHeight);
  const scrollProgress = Math.min(100, Math.round((scrollTop / maxScrollable) * 100));

  let totalProgress = Math.round(
    (chapterIndex / safeTotalChapters + scrollProgress / 100 / safeTotalChapters) * 100
  );

  if (chapterIndex === safeTotalChapters - 1) {
    // scrollHeight=0 означает что DOM ещё не отрисован — в этом случае нельзя считать прогресс 100%
    const fitsWithoutScroll = scrollHeight > 0 && scrollHeight <= clientHeight + 1;
    if (fitsWithoutScroll || scrollProgress >= 98) {
      totalProgress = 100;
    }
  }

  return Math.max(0, Math.min(100, totalProgress));
}

/**
 * Создаёт payload прогресса чтения (legacy v1).
 * @deprecated Используйте createSemanticProgressPayload для v2
 */
export function createReaderProgressPayload(input: ReaderProgressBuildInput): ReaderProgressPayload {
  const {
    chapterId,
    chapterIndex,
    totalChapters,
    scrollTop,
    scrollHeight,
    clientHeight,
    progressOverride,
    timestamp = Date.now(),
    textOffset,
  } = input;

  const progressPercent = typeof progressOverride === "number"
    ? Math.max(0, Math.min(100, progressOverride))
    : calculateReadingProgress(chapterIndex, totalChapters, scrollTop, scrollHeight, clientHeight);

  return {
    currentChapterId: chapterId,
    currentPosition: serializeReaderPosition({
      chapterId,
      scrollTop,
      scrollHeight,
      clientHeight,
      timestamp,
      textOffset,
    }),
    progressPercent,
  };
}

/**
 * Создаёт payload прогресса чтения с семантической позицией (v2).
 * Рекомендуется использовать вместо createReaderProgressPayload.
 */
export function createSemanticProgressPayload(
  input: SemanticProgressBuildInput
): ReaderProgressPayload {
  const { chapterId, chapterIndex, totalChapters, semanticPosition, progressOverride } = input;

  // Используем процент из семантической позиции или вычисляем
  const progressPercent =
    typeof progressOverride === "number"
      ? Math.max(0, Math.min(100, progressOverride))
      : Math.max(0, Math.min(100, semanticPosition.chapterPercent));

  return {
    currentChapterId: chapterId,
    currentPosition: serializeSemanticPosition(semanticPosition),
    progressPercent,
  };
}

export function getReaderProgressSignature(progress: ReaderProgressSnapshot): string {
  return [
    progress.currentChapterId,
    progress.progressPercent,
    progress.currentPosition,
  ].join("|");
}
