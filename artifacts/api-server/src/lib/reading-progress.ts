export type ReadingStatus = "not_started" | "reading" | "finished";

export interface ProgressSnapshot {
  readingStatus: ReadingStatus | null;
  progressPercent: number | null;
  completedAt: Date | null;
}

export interface IncomingProgress {
  progressPercent: number | null;
  readingStatus: ReadingStatus;
}

/**
 * Прочитанная книга не должна снова становиться «читаемой» при повторном
 * открытии: иначе она пропадает с книжной полки, а completedAt обнуляется.
 * Для незавершённых книг применяем присланные значения как есть.
 */
export function resolveProgressUpdate(
  previous: ProgressSnapshot | null,
  incoming: IncomingProgress,
  now: Date = new Date(),
): { readingStatus: ReadingStatus; progressPercent: number | null; completedAt: Date | null } {
  const wasFinished = previous?.readingStatus === "finished";

  if (!wasFinished) {
    return {
      readingStatus: incoming.readingStatus,
      progressPercent: incoming.progressPercent,
      completedAt: incoming.readingStatus === "finished" ? now : null,
    };
  }

  return {
    readingStatus: "finished",
    progressPercent: Math.max(previous?.progressPercent ?? 0, incoming.progressPercent ?? 0),
    completedAt: previous?.completedAt ?? now,
  };
}
