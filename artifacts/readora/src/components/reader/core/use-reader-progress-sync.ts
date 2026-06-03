// Adapted from voxlibris use-reader-progress-sync.ts
// Key differences:
//   - currentChapterId (DB id) instead of currentChapter (1-based number)
//   - currentChapterIdx (0-based) added for progress calculation
//   - canRestorePositionForChapter checks position.chapterId

import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  canRestorePositionForChapter,
  createReaderProgressPayload,
  parseReaderPosition,
  type ReaderProgressPayload,
} from "./reader-progress-core";

interface SaveNowOptions {
  chapterId?: number;
  chapterIdx?: number;
  progressOverride?: number;
}

interface UseDebouncedReaderProgressSaveOptions {
  scrollContainerRef: RefObject<HTMLElement | null>;
  contentAreaRef?: RefObject<HTMLElement | null>;
  currentChapterId: number | null;
  currentChapterIdx: number | null;
  totalChapters: number;
  onSave: (payload: ReaderProgressPayload) => void;
  debounceMs?: number;
  enabled?: boolean;
}

interface UseRestoreReaderScrollOptions {
  scrollContainerRef: RefObject<HTMLElement | null>;
  contentAreaRef?: RefObject<HTMLElement | null>;
  currentChapterId: number | null;
  currentPositionRaw?: string | null;
  contentReady: boolean;
  onProgrammaticScroll?: (holdMs?: number) => void;
  isProgrammaticScroll?: () => boolean;
  delayMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

interface RestoreReaderScrollPositionOptions {
  scrollContainerRef: RefObject<HTMLElement | null>;
  contentAreaRef?: RefObject<HTMLElement | null>;
  currentChapterId: number | null;
  currentPositionRaw?: string | null;
  onProgrammaticScroll?: (holdMs?: number) => void;
  delayMs?: number;
  retryAttempts?: number;
  retryDelayMs?: number;
}

function isScrollIntentKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return false;
  }

  return (
    event.key === " " ||
    event.code === "Space" ||
    event.key === "PageDown" ||
    event.key === "PageUp" ||
    event.key === "ArrowDown" ||
    event.key === "ArrowUp" ||
    event.key === "Home" ||
    event.key === "End"
  );
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function getTopLeftTextOffset(scrollContainer: HTMLElement, contentArea: HTMLElement): number | null {
  const scrollRect = scrollContainer.getBoundingClientRect();
  const contentRect = contentArea.getBoundingClientRect();
  const x = Math.max(contentRect.left + 8, scrollRect.left + 8);
  const y = scrollRect.top + 8;
  const caretDocument = document as CaretDocument;

  let node: Node | null = null;
  let offset = 0;

  if (typeof caretDocument.caretPositionFromPoint === "function") {
    const position = caretDocument.caretPositionFromPoint(x, y);
    if (position) {
      node = position.offsetNode;
      offset = position.offset;
    }
  } else if (typeof caretDocument.caretRangeFromPoint === "function") {
    const range = caretDocument.caretRangeFromPoint(x, y);
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    }
  }

  if (!node || !contentArea.contains(node instanceof HTMLElement ? node : node.parentElement)) {
    return null;
  }

  const range = document.createRange();
  range.setStart(contentArea, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function findTextNodeByOffset(root: HTMLElement, textOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, textOffset);
  let current = walker.nextNode();

  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      const textNode = current as Text;
      const len = textNode.data.length;
      if (remaining <= len) {
        return { node: textNode, offset: Math.min(remaining, len) };
      }
      remaining -= len;
    }
    current = walker.nextNode();
  }

  return null;
}

function restoreByTextOffset(
  scrollContainer: HTMLElement,
  contentArea: HTMLElement,
  textOffset: number,
): boolean {
  const target = findTextNodeByOffset(contentArea, textOffset);
  if (!target) {
    return false;
  }

  const range = document.createRange();
  range.setStart(target.node, target.offset);
  range.setEnd(target.node, target.offset);
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect || rect.height <= 0) {
    return false;
  }

  const scrollRect = scrollContainer.getBoundingClientRect();
  const desiredTop = scrollRect.top + 8;
  const delta = rect.top - desiredTop;
  if (!Number.isFinite(delta)) {
    return false;
  }

  scrollContainer.scrollTop += delta;
  return true;
}

function scheduleReaderScrollRestore({
  scrollContainerRef,
  contentAreaRef,
  currentChapterId,
  currentPositionRaw,
  onProgrammaticScroll,
  delayMs = 300,
  retryAttempts = 4,
  retryDelayMs = 150,
}: RestoreReaderScrollPositionOptions): () => void {
  let restoreTimeout: ReturnType<typeof setTimeout> | null = null;
  let retryTimeout: ReturnType<typeof setTimeout> | null = null;

  if (currentChapterId === null || !currentPositionRaw) {
    return () => {
      if (restoreTimeout) clearTimeout(restoreTimeout);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }

  const position = parseReaderPosition(currentPositionRaw);
  if (!position || !canRestorePositionForChapter(position, currentChapterId)) {
    return () => {
      if (restoreTimeout) clearTimeout(restoreTimeout);
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }

  const normalizedSavedScrollTop = Math.max(0, position.scrollTop);
  const savedScrollable =
    typeof position.scrollHeight === "number" && typeof position.clientHeight === "number"
      ? Math.max(1, position.scrollHeight - position.clientHeight)
      : null;
  let attemptsLeft = retryAttempts;
  let userInteracted = false;
  const container = scrollContainerRef.current;

  const detachInteractionListeners = () => {
    if (!container) {
      document.removeEventListener("keydown", handleKeyDown);
      return;
    }
    container.removeEventListener("wheel", markUserInteraction);
    container.removeEventListener("touchstart", markUserInteraction);
    container.removeEventListener("pointerdown", markUserInteraction);
    document.removeEventListener("keydown", handleKeyDown);
  };

  const markUserInteraction = () => {
    userInteracted = true;
    detachInteractionListeners();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (isScrollIntentKey(event)) {
      markUserInteraction();
    }
  };

  container?.addEventListener("wheel", markUserInteraction, { passive: true });
  container?.addEventListener("touchstart", markUserInteraction, { passive: true });
  container?.addEventListener("pointerdown", markUserInteraction, { passive: true });
  document.addEventListener("keydown", handleKeyDown);

  const restorePosition = () => {
    if (userInteracted) return;

    if (!container) return;

    const contentArea = contentAreaRef?.current ?? null;
    if (
      contentArea &&
      typeof position.textOffset === "number" &&
      (onProgrammaticScroll?.(Math.max(400, retryDelayMs + 120)), true) &&
      restoreByTextOffset(container, contentArea, position.textOffset)
    ) {
      return;
    }

    let targetScrollTop = normalizedSavedScrollTop;

    if (savedScrollable !== null) {
      targetScrollTop = Math.round(
        Math.min(1, normalizedSavedScrollTop / savedScrollable) *
          Math.max(1, container.scrollHeight - container.clientHeight)
      );
    }

    onProgrammaticScroll?.(Math.max(400, retryDelayMs + 120));
    container.scrollTop = targetScrollTop;
    const restored = Math.abs(container.scrollTop - targetScrollTop) <= 2;

    if (!restored && attemptsLeft > 0) {
      attemptsLeft -= 1;
      retryTimeout = setTimeout(restorePosition, retryDelayMs);
    }
  };

  restoreTimeout = setTimeout(restorePosition, delayMs);

  return () => {
    if (restoreTimeout) clearTimeout(restoreTimeout);
    if (retryTimeout) clearTimeout(retryTimeout);
    detachInteractionListeners();
  };
}

export function restoreReaderScrollPosition(options: RestoreReaderScrollPositionOptions): () => void {
  return scheduleReaderScrollRestore(options);
}

export function useDebouncedReaderProgressSave({
  scrollContainerRef,
  contentAreaRef,
  currentChapterId,
  currentChapterIdx,
  totalChapters,
  onSave,
  debounceMs = 1000,
  enabled = true,
}: UseDebouncedReaderProgressSaveOptions) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const saveNow = useCallback((options?: SaveNowOptions) => {
    if (!enabled) return;

    const container = scrollContainerRef.current;
    if (!container) {
      console.warn('[DebouncedSave] saveNow: No scroll container');
      return;
    }

    const chapterId = options?.chapterId ?? currentChapterId;
    const chapterIdx = options?.chapterIdx ?? currentChapterIdx;
    if (chapterId === null || chapterIdx === null) {
      console.warn('[DebouncedSave] saveNow: No chapter selected');
      return;
    }

    console.log('[DebouncedSave] saveNow called:', {
      chapterId,
      chapterIdx,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      isScrollable: container.scrollHeight > container.clientHeight,
      maxScroll: Math.max(0, container.scrollHeight - container.clientHeight),
    });

    const payload = createReaderProgressPayload({
      chapterId,
      chapterIndex: chapterIdx,
      totalChapters,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      progressOverride: options?.progressOverride,
      textOffset: contentAreaRef?.current
        ? getTopLeftTextOffset(container, contentAreaRef.current) ?? undefined
        : undefined,
    });

    console.log('[DebouncedSave] Created payload:', {
      chapterId: payload.currentChapterId,
      progressPercent: payload.progressPercent,
    });

    onSave(payload);
  }, [enabled, scrollContainerRef, contentAreaRef, currentChapterId, currentChapterIdx, totalChapters, onSave]);

  const scheduleSave = useCallback(() => {
    if (!enabled) return;

    const container = scrollContainerRef.current;
    if (!container) {
      console.warn('[DebouncedSave] No scroll container found');
      return;
    }

    console.log('[DebouncedSave] Scroll detected, scheduling save. Current scrollTop:', container.scrollTop);
    cancelPendingSave();
    timeoutRef.current = setTimeout(() => {
      console.log('[DebouncedSave] Debounce timeout reached, saving now');
      saveNow();
    }, debounceMs);
  }, [enabled, debounceMs, cancelPendingSave, saveNow, scrollContainerRef]);

  useEffect(() => {
    return () => {
      cancelPendingSave();
    };
  }, [cancelPendingSave]);

  return {
    scheduleSave,
    saveNow,
    cancelPendingSave,
  };
}

export function useRestoreReaderScroll({
  scrollContainerRef,
  contentAreaRef,
  currentChapterId,
  currentPositionRaw,
  contentReady,
  onProgrammaticScroll,
  isProgrammaticScroll,
  delayMs = 300,
  retryAttempts = 4,
  retryDelayMs = 150,
}: UseRestoreReaderScrollOptions) {
  const restoredChaptersRef = useRef<Set<number>>(new Set());
  const interactedChaptersRef = useRef<Set<number>>(new Set());
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (currentChapterId === null) {
      return;
    }

    const container = scrollContainerRef.current;
    if (!container) {
      return;
    }

    const markInteracted = () => {
      if (isProgrammaticScroll?.()) {
        return;
      }
      interactedChaptersRef.current.add(currentChapterId);
    };

    container.addEventListener("scroll", markInteracted, { passive: true });

    return () => {
      container.removeEventListener("scroll", markInteracted);
    };
  }, [currentChapterId, scrollContainerRef, isProgrammaticScroll]);

  useEffect(() => {
    if (currentChapterId === null) return;

    if (restoredChaptersRef.current.has(currentChapterId)) {
      return;
    }

    if (interactedChaptersRef.current.has(currentChapterId)) {
      restoredChaptersRef.current.add(currentChapterId);
      return;
    }

    if (!contentReady || !currentPositionRaw) {
      return;
    }

    const position = parseReaderPosition(currentPositionRaw);
    if (!position || !canRestorePositionForChapter(position, currentChapterId)) {
      restoredChaptersRef.current.add(currentChapterId);
      return;
    }

    restoredChaptersRef.current.add(currentChapterId);
    if (cleanupRef.current) {
      cleanupRef.current();
    }
    cleanupRef.current = scheduleReaderScrollRestore({
      scrollContainerRef,
      contentAreaRef,
      currentChapterId,
      currentPositionRaw,
      onProgrammaticScroll,
      delayMs,
      retryAttempts,
      retryDelayMs,
    });
  }, [contentReady, currentChapterId, currentPositionRaw, scrollContainerRef, contentAreaRef, onProgrammaticScroll, delayMs, retryAttempts, retryDelayMs]);

  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
      }
    };
  }, []);
}

// ---------------------------------------------------------------------------
// usePeriodicProgressSave — auto-save progress every N seconds during reading
// ---------------------------------------------------------------------------
interface UsePeriodicProgressSaveOptions {
  saveNow: () => void;
  intervalMs?: number;
  enabled?: boolean;
}

export function usePeriodicProgressSave({
  saveNow,
  intervalMs = 10000, // 10 seconds by default
  enabled = true,
}: UsePeriodicProgressSaveOptions) {
  useEffect(() => {
    if (!enabled) return;

    console.log('[PeriodicSave] Starting periodic save with interval:', intervalMs);
    
    const interval = setInterval(() => {
      console.log('[PeriodicSave] Triggering periodic save');
      saveNow();
    }, intervalMs);

    return () => {
      console.log('[PeriodicSave] Stopping periodic save');
      clearInterval(interval);
    };
  }, [saveNow, intervalMs, enabled]);
}
