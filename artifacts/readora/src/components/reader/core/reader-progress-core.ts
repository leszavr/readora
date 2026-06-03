// Adapted from voxlibris reader-progress-core.ts
// Key difference: uses chapterId (DB id) + chapterIndex (0-based) instead of
// 1-based currentChapter; progress field is named progressPercent.

export interface ReaderPositionPayload {
  chapterId?: number;
  scrollTop: number;
  scrollHeight?: number;
  clientHeight?: number;
  timestamp?: number;
  textOffset?: number;
}

export interface ReaderProgressPayload {
  currentChapterId: number;
  currentPosition: string;
  progressPercent: number;
}

export interface ReaderProgressSnapshot {
  currentChapterId: number;
  currentPosition: string;
  progressPercent: number;
}

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

export function serializeReaderPosition(position: ReaderPositionPayload): string {
  return JSON.stringify(position);
}

export function parseReaderPosition(raw: string | null | undefined): ReaderPositionPayload | null {
  if (!raw) return null;

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

export function canRestorePositionForChapter(
  position: ReaderPositionPayload,
  currentChapterId: number
): boolean {
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

export function getReaderProgressSignature(progress: ReaderProgressSnapshot): string {
  return [
    progress.currentChapterId,
    progress.progressPercent,
    progress.currentPosition,
  ].join("|");
}
