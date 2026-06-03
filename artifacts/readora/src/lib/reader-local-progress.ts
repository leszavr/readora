// Adapted from voxlibris reader-local-progress.ts
// Uses currentChapterId / progressPercent field names (readora API contract)

interface ReaderProgressSnapshot {
  currentChapterId: number;
  currentPosition: string;
  progressPercent: number;
}

type ReaderProgressScope = {
  bookId: number;
};

const READER_PROGRESS_STORAGE_PREFIX = "readora:reader-progress";

function getProgressStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function getReaderProgressStorageKey(scope: ReaderProgressScope): string {
  return `${READER_PROGRESS_STORAGE_PREFIX}:${scope.bookId}`;
}

function isReaderProgressSnapshot(value: unknown): value is ReaderProgressSnapshot {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const snapshot = value as Partial<ReaderProgressSnapshot>;
  return (
    typeof snapshot.currentChapterId === "number" &&
    typeof snapshot.currentPosition === "string" &&
    typeof snapshot.progressPercent === "number"
  );
}

function getReaderPositionTimestamp(currentPosition: string): number | null {
  try {
    const parsed = JSON.parse(currentPosition) as { timestamp?: unknown };
    return typeof parsed.timestamp === "number" ? parsed.timestamp : null;
  } catch {
    return null;
  }
}

function isReaderProgressNewer(
  candidate: ReaderProgressSnapshot,
  baseline: ReaderProgressSnapshot
): boolean {
  const candidateTimestamp = getReaderPositionTimestamp(candidate.currentPosition);
  const baselineTimestamp = getReaderPositionTimestamp(baseline.currentPosition);

  if (candidateTimestamp !== null || baselineTimestamp !== null) {
    if (candidateTimestamp === null) {
      return false;
    }
    if (baselineTimestamp === null) {
      return true;
    }
    if (candidateTimestamp !== baselineTimestamp) {
      return candidateTimestamp > baselineTimestamp;
    }
  }

  if (candidate.currentChapterId !== baseline.currentChapterId) {
    return candidate.currentChapterId > baseline.currentChapterId;
  }

  if (candidate.progressPercent !== baseline.progressPercent) {
    return candidate.progressPercent > baseline.progressPercent;
  }

  return candidate.currentPosition !== baseline.currentPosition;
}

export function loadReaderProgressFromStorage(scope: ReaderProgressScope): ReaderProgressSnapshot | null {
  const storage = getProgressStorage();
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(getReaderProgressStorageKey(scope));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return isReaderProgressSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveReaderProgressToStorage(
  scope: ReaderProgressScope,
  progress: ReaderProgressSnapshot
): void {
  const storage = getProgressStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(getReaderProgressStorageKey(scope), JSON.stringify(progress));
  } catch {
    // Ignore storage quota and privacy mode failures.
  }
}

export function getFreshestReaderProgress(
  remoteProgress: ReaderProgressSnapshot | null | undefined,
  localProgress: ReaderProgressSnapshot | null | undefined
): ReaderProgressSnapshot | null {
  if (!remoteProgress) {
    return localProgress ?? null;
  }

  if (!localProgress) {
    return remoteProgress;
  }

  return isReaderProgressNewer(localProgress, remoteProgress) ? localProgress : remoteProgress;
}
