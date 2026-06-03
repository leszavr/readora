// Adapted from voxlibris use-reader-latest-progress.ts
// Key differences:
//   - Uses currentChapterId + currentChapterIdx instead of 1-based currentChapter
//   - Takes chapters array to map chapterId -> array index for comparison
//   - RemoteReadingProgress uses progressPercent instead of progress

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  createReaderProgressPayload,
  getReaderProgressSignature,
  parseReaderPosition,
} from "./reader-progress-core";

interface RemoteReadingProgress {
  currentChapterId: number;
  currentPosition: string;
  progressPercent: number;
}

interface ChapterRef {
  id: number;
}

interface UseReaderLatestProgressOptions {
  currentChapterId: number | null;
  currentChapterIdx: number | null;
  chapters: ChapterRef[];
  totalChapters: number;
  scrollContainerRef: RefObject<HTMLElement | null>;
  remoteProgress?: RemoteReadingProgress | null;
  refreshProgress: () => Promise<unknown>;
  enabled?: boolean;
  hasLocalReadingActivity?: boolean;
  isLocalSessionProgress?: (progress: RemoteReadingProgress) => boolean;
}

function isRemoteProgressAhead(
  remoteProgress: RemoteReadingProgress,
  currentChapterId: number | null,
  currentChapterIdx: number | null,
  totalChapters: number,
  chapters: ChapterRef[],
  scrollContainerRef: RefObject<HTMLElement | null>
): boolean {
  if (currentChapterId === null || currentChapterIdx === null) {
    return false;
  }

  const remoteChapterIdx = chapters.findIndex((c) => c.id === remoteProgress.currentChapterId);

  const container = scrollContainerRef.current;
  if (!container) {
    return remoteChapterIdx > currentChapterIdx;
  }

  const localPayload = createReaderProgressPayload({
    chapterId: currentChapterId,
    chapterIndex: currentChapterIdx,
    totalChapters,
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    clientHeight: container.clientHeight,
  });

  if (remoteChapterIdx > currentChapterIdx) {
    return true;
  }

  if (remoteChapterIdx < currentChapterIdx) {
    return false;
  }

  if (remoteProgress.progressPercent > localPayload.progressPercent + 1) {
    return true;
  }

  if (remoteProgress.progressPercent < localPayload.progressPercent - 1) {
    return false;
  }

  const remotePosition = parseReaderPosition(remoteProgress.currentPosition);
  if (!remotePosition || remotePosition.chapterId !== currentChapterId) {
    return false;
  }

  const localScrollable = Math.max(1, container.scrollHeight - container.clientHeight);
  const remoteScrollable =
    typeof remotePosition.scrollHeight === "number" && typeof remotePosition.clientHeight === "number"
      ? Math.max(1, remotePosition.scrollHeight - remotePosition.clientHeight)
      : localScrollable;
  const localRatio = Math.min(1, container.scrollTop / localScrollable);
  const remoteRatio = Math.min(1, remotePosition.scrollTop / remoteScrollable);

  return remoteRatio > localRatio + 0.03;
}

export function useReaderLatestProgress({
  currentChapterId,
  currentChapterIdx,
  chapters,
  totalChapters,
  scrollContainerRef,
  remoteProgress,
  refreshProgress,
  enabled = true,
  hasLocalReadingActivity = true,
  isLocalSessionProgress,
}: UseReaderLatestProgressOptions) {
  const [suggestedProgress, setSuggestedProgress] = useState<RemoteReadingProgress | null>(null);
  const dismissedSignatureRef = useRef<string | null>(null);
  const refreshCooldownRef = useRef(0);
  const processedRemoteSignatureRef = useRef<string | null>(null);

  const remoteSignature = useMemo(
    () => (remoteProgress ? getReaderProgressSignature(remoteProgress) : null),
    [remoteProgress]
  );

  const dismissSuggestion = useCallback(() => {
    if (remoteProgress) {
      dismissedSignatureRef.current = getReaderProgressSignature(remoteProgress);
    }
    setSuggestedProgress(null);
  }, [remoteProgress]);

  useEffect(() => {
    if (
      !enabled ||
      !remoteProgress ||
      currentChapterId === null ||
      currentChapterIdx === null ||
      totalChapters <= 0 ||
      !hasLocalReadingActivity
    ) {
      setSuggestedProgress(null);
      return;
    }

    if (isLocalSessionProgress?.(remoteProgress)) {
      setSuggestedProgress((current) =>
        current && getReaderProgressSignature(current) === remoteSignature ? null : current
      );
      processedRemoteSignatureRef.current = remoteSignature;
      return;
    }

    if (processedRemoteSignatureRef.current === remoteSignature) {
      return;
    }

    processedRemoteSignatureRef.current = remoteSignature;

    if (dismissedSignatureRef.current === remoteSignature) {
      return;
    }

    if (
      isRemoteProgressAhead(
        remoteProgress,
        currentChapterId,
        currentChapterIdx,
        totalChapters,
        chapters,
        scrollContainerRef
      )
    ) {
      setSuggestedProgress(remoteProgress);
      return;
    }

    setSuggestedProgress((current) =>
      current && getReaderProgressSignature(current) === remoteSignature ? null : current
    );
  }, [
    chapters,
    currentChapterId,
    currentChapterIdx,
    enabled,
    hasLocalReadingActivity,
    isLocalSessionProgress,
    remoteProgress,
    remoteSignature,
    scrollContainerRef,
    totalChapters,
  ]);

  useEffect(() => {
    if (
      !enabled ||
      !suggestedProgress ||
      currentChapterId === null ||
      currentChapterIdx === null ||
      totalChapters <= 0 ||
      !hasLocalReadingActivity
    ) {
      if (!hasLocalReadingActivity) {
        setSuggestedProgress(null);
      }
      return;
    }

    if (isLocalSessionProgress?.(suggestedProgress)) {
      setSuggestedProgress(null);
      return;
    }

    if (
      !isRemoteProgressAhead(
        suggestedProgress,
        currentChapterId,
        currentChapterIdx,
        totalChapters,
        chapters,
        scrollContainerRef
      )
    ) {
      setSuggestedProgress(null);
    }
  }, [
    chapters,
    currentChapterId,
    currentChapterIdx,
    enabled,
    hasLocalReadingActivity,
    isLocalSessionProgress,
    scrollContainerRef,
    suggestedProgress,
    totalChapters,
  ]);

  useEffect(() => {
    if (!enabled) return;

    const requestRefresh = () => {
      const now = Date.now();
      if (now - refreshCooldownRef.current < 1200) {
        return;
      }
      refreshCooldownRef.current = now;
      void refreshProgress();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestRefresh();
      }
    };

    window.addEventListener("focus", requestRefresh);
    window.addEventListener("online", requestRefresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", requestRefresh);
      window.removeEventListener("online", requestRefresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [enabled, refreshProgress]);

  return {
    suggestedProgress,
    dismissSuggestion,
  };
}
