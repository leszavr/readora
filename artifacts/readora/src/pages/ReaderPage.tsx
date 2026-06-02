import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetBook,
  useListChapters,
  useGetChapter,
  useGetProgress,
  useSaveProgress,
  useSaveReaderSettings,
  ReaderSettingsInputTheme,
  type ReadingProgress,
} from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, List, Settings, ChevronLeft, ChevronRight, BookOpen, Loader2, Maximize2, Minimize2, X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getGetChapterQueryKey, getGetProgressQueryKey } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

const FONTS = ["Georgia", "Arial", "Times New Roman", "Verdana", "Palatino"];
const SAVE_DEBOUNCE_MS = 1000;
const RESTORE_DELAY_MS = 160;
const RESTORE_RETRY_ATTEMPTS = 5;
const RESTORE_RETRY_DELAY_MS = 130;

type DeviceMode = "desktop" | "mobile";

interface ReaderPositionPayload {
  chapterId?: number;
  scrollTop: number;
  scrollHeight?: number;
  clientHeight?: number;
  timestamp?: number;
  textOffset?: number;
}

interface ReaderProgressSnapshot {
  currentChapterId: number | null;
  currentPosition: string | null;
  progressPercent: number | null;
}

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function getDeviceMode(): DeviceMode {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(pointer: coarse), (max-width: 767px)").matches ? "mobile" : "desktop";
}

async function fetchReaderSettings(deviceMode: DeviceMode) {
  const res = await fetch(`/api/reader/settings?deviceMode=${deviceMode}`, { credentials: "include" });
  if (!res.ok) throw new Error("Не удалось загрузить настройки ридера");
  return res.json() as Promise<{
    fontSize: number;
    fontFamily: string;
    lineHeight: number;
    theme: "light" | "sepia" | "dark";
    contentWidth: number;
  }>;
}

function isInteractiveElement(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(
    "input, textarea, select, button, a, [role='button'], [contenteditable='true']"
  ));
}

function getLocalProgressKey(bookId: number): string {
  return `readora:reader-progress:${bookId}`;
}

function parseReaderPosition(raw: string | null | undefined): ReaderPositionPayload | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ReaderPositionPayload>;
    if (!parsed || typeof parsed !== "object" || typeof parsed.scrollTop !== "number") {
      return null;
    }

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

function getPositionTimestamp(raw: string | null | undefined): number | null {
  const position = parseReaderPosition(raw);
  return typeof position?.timestamp === "number" ? position.timestamp : null;
}

function normalizeProgressSnapshot(progress: ReadingProgress | null | undefined): ReaderProgressSnapshot | null {
  if (!progress) {
    return null;
  }

  return {
    currentChapterId: typeof progress.currentChapterId === "number" ? progress.currentChapterId : null,
    currentPosition: typeof progress.currentPosition === "string" ? progress.currentPosition : null,
    progressPercent: typeof progress.progressPercent === "number" ? progress.progressPercent : null,
  };
}

function isProgressNewer(candidate: ReaderProgressSnapshot, baseline: ReaderProgressSnapshot): boolean {
  const candidateTimestamp = getPositionTimestamp(candidate.currentPosition);
  const baselineTimestamp = getPositionTimestamp(baseline.currentPosition);

  if (candidateTimestamp !== null || baselineTimestamp !== null) {
    if (candidateTimestamp === null) return false;
    if (baselineTimestamp === null) return true;
    if (candidateTimestamp !== baselineTimestamp) {
      return candidateTimestamp > baselineTimestamp;
    }
  }

  if (candidate.currentChapterId !== baseline.currentChapterId) {
    return (candidate.currentChapterId ?? -1) > (baseline.currentChapterId ?? -1);
  }

  if (candidate.progressPercent !== baseline.progressPercent) {
    return (candidate.progressPercent ?? -1) > (baseline.progressPercent ?? -1);
  }

  return candidate.currentPosition !== baseline.currentPosition;
}

function getFreshestProgress(
  remoteProgress: ReaderProgressSnapshot | null,
  localProgress: ReaderProgressSnapshot | null,
): ReaderProgressSnapshot | null {
  if (!remoteProgress) return localProgress;
  if (!localProgress) return remoteProgress;
  return isProgressNewer(localProgress, remoteProgress) ? localProgress : remoteProgress;
}

function loadLocalProgress(bookId: number): ReaderProgressSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getLocalProgressKey(bookId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<ReaderProgressSnapshot>;
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    return {
      currentChapterId: typeof parsed.currentChapterId === "number" ? parsed.currentChapterId : null,
      currentPosition: typeof parsed.currentPosition === "string" ? parsed.currentPosition : null,
      progressPercent: typeof parsed.progressPercent === "number" ? parsed.progressPercent : null,
    };
  } catch {
    return null;
  }
}

function saveLocalProgress(bookId: number, snapshot: ReaderProgressSnapshot): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(getLocalProgressKey(bookId), JSON.stringify(snapshot));
  } catch {
    // Ignore quota and private mode failures.
  }
}

function calculateReadingProgress(
  chapterIndex: number,
  totalChapters: number,
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): number {
  const safeTotal = Math.max(1, totalChapters);
  const maxScrollable = Math.max(1, scrollHeight - clientHeight);
  const scrollProgress = Math.min(100, Math.round((Math.max(0, scrollTop) / maxScrollable) * 100));

  let totalProgress = Math.round(((chapterIndex / safeTotal) + (scrollProgress / 100 / safeTotal)) * 100);

  if (chapterIndex === safeTotal - 1) {
    const fitsWithoutScroll = scrollHeight > 0 && scrollHeight <= clientHeight + 1;
    if (fitsWithoutScroll || scrollProgress >= 98) {
      totalProgress = 100;
    }
  }

  return Math.max(0, Math.min(100, totalProgress));
}

function createReaderProgressPayload(input: {
  chapterId: number;
  chapterIndex: number;
  totalChapters: number;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  textOffset?: number;
  timestamp?: number;
}) {
  const timestamp = input.timestamp ?? Date.now();
  const progressPercent = calculateReadingProgress(
    input.chapterIndex,
    input.totalChapters,
    input.scrollTop,
    input.scrollHeight,
    input.clientHeight,
  );

  const position: ReaderPositionPayload = {
    chapterId: input.chapterId,
    scrollTop: input.scrollTop,
    scrollHeight: input.scrollHeight,
    clientHeight: input.clientHeight,
    timestamp,
    textOffset: input.textOffset,
  };

  return {
    currentChapterId: input.chapterId,
    currentPosition: JSON.stringify(position),
    progressPercent,
  };
}

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

export default function ReaderPage() {
  const [, params] = useRoute("/reader/:id");
  const bookId = parseInt(params?.id ?? "0", 10);
  const qc = useQueryClient();

  const { data: book } = useGetBook(bookId);
  const { data: chapters = [] } = useListChapters(bookId);
  const { data: progress } = useGetProgress(bookId);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>(() => getDeviceMode());
  const { data: settings } = useQuery({
    queryKey: ["reader-settings", deviceMode],
    queryFn: () => fetchReaderSettings(deviceMode),
    staleTime: 1000 * 60 * 5,
  });

  const { mutate: saveSettings } = useSaveReaderSettings();
  const { mutate: saveProgress } = useSaveProgress();

  const [currentChapterIdx, setCurrentChapterIdx] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [localProgressSnapshot, setLocalProgressSnapshot] = useState<ReaderProgressSnapshot | null>(null);

  // Local reader settings
  const [fontSize, setFontSize] = useState(18);
  const [fontFamily, setFontFamily] = useState("Georgia");
  const [lineHeight, setLineHeight] = useState(1.7);
  const [theme, setTheme] = useState<"light" | "sepia" | "dark">("light");
  const [contentWidth, setContentWidth] = useState(80);

  const contentRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const readerRootRef = useRef<HTMLDivElement>(null);
  const tocPanelRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const tocActiveChapterRef = useRef<HTMLButtonElement | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const restoredChapterIdsRef = useRef<Set<number>>(new Set());
  const interactedChapterIdsRef = useRef<Set<number>>(new Set());
  const hasInitializedChapterRef = useRef(false);
  const pendingRestoreChapterIdRef = useRef<number | null>(null);
  const lastSpaceScrollAtRef = useRef(0);

  const freshestProgress = useMemo(() => {
    return getFreshestProgress(normalizeProgressSnapshot(progress), localProgressSnapshot);
  }, [progress, localProgressSnapshot]);

  const currentChapter = chapters[currentChapterIdx];
  const { data: chapterContent, isLoading: chapterLoading } = useGetChapter(
    bookId,
    currentChapter?.id ?? 0,
    { query: { queryKey: getGetChapterQueryKey(bookId, currentChapter?.id ?? 0), enabled: !!currentChapter } }
  );

  const setProgrammaticScroll = useCallback((holdMs: number) => {
    programmaticScrollUntilRef.current = Date.now() + holdMs;
  }, []);

  const isProgrammaticScroll = useCallback(() => {
    return Date.now() < programmaticScrollUntilRef.current;
  }, []);

  const persistSnapshotLocally = useCallback((snapshot: ReaderProgressSnapshot) => {
    setLocalProgressSnapshot(snapshot);
    saveLocalProgress(bookId, snapshot);
  }, [bookId]);

  const saveNow = useCallback((options?: { chapterId?: number; chapterIndex?: number; keepalive?: boolean }) => {
    const container = contentRef.current;
    if (!container || !chapters.length) {
      return;
    }

    const chapterId = options?.chapterId ?? currentChapter?.id;
    const chapterIndex = options?.chapterIndex ?? currentChapterIdx;
    if (typeof chapterId !== "number") {
      return;
    }

    const payload = createReaderProgressPayload({
      chapterId,
      chapterIndex,
      totalChapters: chapters.length,
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
      textOffset: contentAreaRef.current ? getTopLeftTextOffset(container, contentAreaRef.current) ?? undefined : undefined,
    });

    const readingStatus = payload.progressPercent >= 99 ? "finished" : "reading";
    const snapshot: ReaderProgressSnapshot = {
      currentChapterId: payload.currentChapterId,
      currentPosition: payload.currentPosition,
      progressPercent: payload.progressPercent,
    };

    persistSnapshotLocally(snapshot);

    if (options?.keepalive) {
      fetch(`/api/books/${bookId}/progress`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        keepalive: true,
        body: JSON.stringify({
          ...payload,
          readingStatus,
        }),
      }).catch(() => undefined);
      return;
    }

    saveProgress({
      id: bookId,
      data: {
        ...payload,
        readingStatus,
      },
    }, {
      onSuccess: (saved) => {
        const normalized = normalizeProgressSnapshot(saved);
        if (normalized) {
          persistSnapshotLocally(normalized);
        }
        qc.setQueryData(getGetProgressQueryKey(bookId), saved);
      },
    });
  }, [bookId, chapters, currentChapter, currentChapterIdx, persistSnapshotLocally, qc, saveProgress]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }

    saveTimerRef.current = setTimeout(() => {
      saveNow();
    }, SAVE_DEBOUNCE_MS);
  }, [saveNow]);

  const navigateToChapterIndex = useCallback((nextIndex: number) => {
    if (!chapters.length) {
      return;
    }

    const boundedIndex = Math.max(0, Math.min(chapters.length - 1, nextIndex));
    if (boundedIndex === currentChapterIdx) {
      return;
    }

    const prevChapter = chapters[currentChapterIdx];
    if (prevChapter) {
      saveNow({
        chapterId: prevChapter.id,
        chapterIndex: currentChapterIdx,
      });
    }

    pendingRestoreChapterIdRef.current = null;
    setCurrentChapterIdx(boundedIndex);
    setProgrammaticScroll(220);

    requestAnimationFrame(() => {
      contentRef.current?.scrollTo({ top: 0, behavior: "auto" });
    });
  }, [chapters, currentChapterIdx, saveNow, setProgrammaticScroll]);

  const goToPrevChapter = useCallback(() => {
    navigateToChapterIndex(currentChapterIdx - 1);
  }, [currentChapterIdx, navigateToChapterIndex]);

  const goToNextChapter = useCallback(() => {
    navigateToChapterIndex(currentChapterIdx + 1);
  }, [currentChapterIdx, navigateToChapterIndex]);

  useEffect(() => {
    const updateDeviceMode = () => setDeviceMode(getDeviceMode());
    window.addEventListener("resize", updateDeviceMode);
    window.addEventListener("orientationchange", updateDeviceMode);
    return () => {
      window.removeEventListener("resize", updateDeviceMode);
      window.removeEventListener("orientationchange", updateDeviceMode);
    };
  }, []);

  useEffect(() => {
    setLocalProgressSnapshot(loadLocalProgress(bookId));
    hasInitializedChapterRef.current = false;
    pendingRestoreChapterIdRef.current = null;
    restoredChapterIdsRef.current.clear();
    interactedChapterIdsRef.current.clear();
  }, [bookId]);

  useEffect(() => {
    if (settings) {
      setFontSize(settings.fontSize ?? 18);
      setFontFamily(settings.fontFamily ?? "Georgia");
      setLineHeight(settings.lineHeight ?? 1.7);
      setTheme((settings.theme as "light" | "sepia" | "dark") ?? "light");
      setContentWidth(settings.contentWidth ?? (deviceMode === "mobile" ? 95 : 80));
    }
  }, [settings, deviceMode]);

  useEffect(() => {
    if (hasInitializedChapterRef.current || chapters.length === 0) {
      return;
    }

    let targetIdx = 0;
    if (freshestProgress?.currentChapterId) {
      const idx = chapters.findIndex((chapter) => chapter.id === freshestProgress.currentChapterId);
      if (idx >= 0) {
        targetIdx = idx;
        pendingRestoreChapterIdRef.current = chapters[idx]?.id ?? null;
      }
    }

    setCurrentChapterIdx(targetIdx);
    hasInitializedChapterRef.current = true;
  }, [chapters, freshestProgress]);

  useEffect(() => {
    if (!tocOpen) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      tocActiveChapterRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });

    return () => cancelAnimationFrame(frame);
  }, [tocOpen, currentChapterIdx]);

  useEffect(() => {
    if (!currentChapter) {
      return;
    }

    const container = contentRef.current;
    if (!container) {
      return;
    }

    const onScroll = () => {
      if (!isProgrammaticScroll()) {
        interactedChapterIdsRef.current.add(currentChapter.id);
      }
      scheduleSave();
    };

    container.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", onScroll);
    };
  }, [currentChapter, isProgrammaticScroll, scheduleSave]);

  useEffect(() => {
    if (!currentChapter || chapterLoading) {
      return;
    }

    if (restoredChapterIdsRef.current.has(currentChapter.id)) {
      return;
    }

    if (interactedChapterIdsRef.current.has(currentChapter.id) && pendingRestoreChapterIdRef.current !== currentChapter.id) {
      restoredChapterIdsRef.current.add(currentChapter.id);
      return;
    }

    const positionRaw = freshestProgress?.currentPosition;
    const position = parseReaderPosition(positionRaw);

    if (!positionRaw || !position || position.chapterId !== currentChapter.id) {
      restoredChapterIdsRef.current.add(currentChapter.id);
      pendingRestoreChapterIdRef.current = null;
      return;
    }

    const container = contentRef.current;
    const contentArea = contentAreaRef.current;
    if (!container) {
      return;
    }

    let attemptsLeft = RESTORE_RETRY_ATTEMPTS;

    const restorePosition = () => {
      const activeContainer = contentRef.current;
      if (!activeContainer) {
        return;
      }

      let restored = false;
      if (contentArea && typeof position.textOffset === "number") {
        setProgrammaticScroll(Math.max(400, RESTORE_RETRY_DELAY_MS + 120));
        restored = restoreByTextOffset(activeContainer, contentArea, position.textOffset);
      }

      if (!restored) {
        const maxScrollableNow = Math.max(1, activeContainer.scrollHeight - activeContainer.clientHeight);
        const savedMaxScrollable = typeof position.scrollHeight === "number" && typeof position.clientHeight === "number"
          ? Math.max(1, position.scrollHeight - position.clientHeight)
          : null;

        const targetScrollTop = savedMaxScrollable
          ? Math.round(Math.min(1, Math.max(0, position.scrollTop) / savedMaxScrollable) * maxScrollableNow)
          : Math.max(0, position.scrollTop);

        setProgrammaticScroll(Math.max(400, RESTORE_RETRY_DELAY_MS + 120));
        activeContainer.scrollTop = targetScrollTop;
        restored = Math.abs(activeContainer.scrollTop - targetScrollTop) <= 2;
      }

      if (!restored && attemptsLeft > 0) {
        attemptsLeft -= 1;
        restoreRetryTimerRef.current = setTimeout(restorePosition, RESTORE_RETRY_DELAY_MS);
        return;
      }

      restoredChapterIdsRef.current.add(currentChapter.id);
      pendingRestoreChapterIdRef.current = null;
    };

    restoreTimerRef.current = setTimeout(restorePosition, RESTORE_DELAY_MS);

    return () => {
      if (restoreTimerRef.current) {
        clearTimeout(restoreTimerRef.current);
        restoreTimerRef.current = null;
      }
      if (restoreRetryTimerRef.current) {
        clearTimeout(restoreRetryTimerRef.current);
        restoreRetryTimerRef.current = null;
      }
    };
  }, [chapterLoading, currentChapter, freshestProgress, setProgrammaticScroll]);

  const closePanels = useCallback(() => {
    setTocOpen(false);
    setSettingsOpen(false);
  }, []);

  function persistSettings(partial: Partial<{ fontSize: number; fontFamily: string; lineHeight: number; theme: ReaderSettingsInputTheme; contentWidth: number }>) {
    const updated = {
      fontSize: partial.fontSize ?? fontSize,
      fontFamily: partial.fontFamily ?? fontFamily,
      lineHeight: partial.lineHeight ?? lineHeight,
      theme: partial.theme ?? theme,
      contentWidth: partial.contentWidth ?? contentWidth,
    };
    saveSettings({ data: { ...updated, deviceMode } as typeof updated & { deviceMode: DeviceMode } });
  }

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => undefined);
      return;
    }
    await readerRootRef.current?.requestFullscreen().catch(() => undefined);
  }

  useEffect(() => {
    const isOpen = tocOpen || settingsOpen;
    if (!isOpen) {
      if (panelsTimerRef.current) clearTimeout(panelsTimerRef.current);
      return;
    }

    const panelElements = [tocPanelRef.current, settingsPanelRef.current].filter(Boolean) as HTMLElement[];
    const isInsidePanel = (target: EventTarget | null) => target instanceof Node && panelElements.some((panel) => panel.contains(target));
    const clearPanelTimer = () => {
      if (panelsTimerRef.current) {
        clearTimeout(panelsTimerRef.current);
        panelsTimerRef.current = null;
      }
    };
    const resetPanelTimer = () => {
      clearPanelTimer();
      panelsTimerRef.current = setTimeout(closePanels, 3000);
    };
    const handleDocumentActivity = (event: Event) => {
      if (isInsidePanel(event.target)) {
        clearPanelTimer();
        return;
      }
      resetPanelTimer();
    };
    const handleContentInteraction = (event: Event) => {
      if (!isInsidePanel(event.target)) closePanels();
    };
    const handlePanelEnter = () => clearPanelTimer();
    const handlePanelLeave = () => resetPanelTimer();

    resetPanelTimer();
    document.addEventListener("pointerdown", handleDocumentActivity, true);
    document.addEventListener("pointermove", handleDocumentActivity, true);
    document.addEventListener("keydown", handleDocumentActivity, true);
    contentRef.current?.addEventListener("pointerdown", handleContentInteraction, true);
    contentRef.current?.addEventListener("wheel", handleContentInteraction, true);
    panelElements.forEach((panel) => {
      panel.addEventListener("pointerenter", handlePanelEnter, true);
      panel.addEventListener("pointerleave", handlePanelLeave, true);
      panel.addEventListener("focusin", handlePanelEnter, true);
      panel.addEventListener("focusout", handlePanelLeave, true);
    });

    const contentElement = contentRef.current;
    return () => {
      clearPanelTimer();
      document.removeEventListener("pointerdown", handleDocumentActivity, true);
      document.removeEventListener("pointermove", handleDocumentActivity, true);
      document.removeEventListener("keydown", handleDocumentActivity, true);
      contentElement?.removeEventListener("pointerdown", handleContentInteraction, true);
      contentElement?.removeEventListener("wheel", handleContentInteraction, true);
      panelElements.forEach((panel) => {
        panel.removeEventListener("pointerenter", handlePanelEnter, true);
        panel.removeEventListener("pointerleave", handlePanelLeave, true);
        panel.removeEventListener("focusin", handlePanelEnter, true);
        panel.removeEventListener("focusout", handlePanelLeave, true);
      });
    };
  }, [closePanels, settingsOpen, tocOpen]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        saveNow({ keepalive: true });
      }
    };

    const handlePageHide = () => {
      saveNow({ keepalive: true });
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("pagehide", handlePageHide);
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveNow({ keepalive: true });
    };
  }, [saveNow]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isInteractiveElement(event.target)) return;

      if ((event.key === " " || event.code === "Space") && !event.ctrlKey && !event.altKey && !event.metaKey) {
        const container = contentRef.current;
        if (!container) return;
        const now = Date.now();
        event.preventDefault();
        if (now - lastSpaceScrollAtRef.current < 180) return;
        lastSpaceScrollAtRef.current = now;
        container.scrollBy({
          top: Math.max(160, Math.round(container.clientHeight * 0.9)) * (event.shiftKey ? -1 : 1),
          behavior: "smooth",
        });
        return;
      }

      if (event.key === "ArrowLeft" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        goToPrevChapter();
        return;
      }

      if (event.key === "ArrowRight" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        goToNextChapter();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [goToNextChapter, goToPrevChapter]);

  const THEMES = {
    light: { bg: "bg-white", text: "text-gray-900", ui: "bg-gray-50" },
    sepia: { bg: "bg-amber-50", text: "text-amber-950", ui: "bg-amber-100/50" },
    dark: { bg: "bg-gray-900", text: "text-gray-100", ui: "bg-gray-800" },
  };

  const t = THEMES[theme];

  return (
    <ProtectedRoute>
      <div ref={readerRootRef} className={cn("min-h-screen flex flex-col", t.bg, t.text)}>
        <div className={cn("sticky top-0 z-40 border-b flex items-center justify-between px-4 h-12 gap-4", t.ui, theme === "dark" ? "border-gray-700" : "border-gray-200")}>
          <div className="flex items-center gap-2">
            <Link href={`/book/${bookId}`}>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="w-4 h-4" />
              </Button>
            </Link>
            <div className="hidden sm:block">
              <p className="text-sm font-medium line-clamp-1">{book?.title ?? "Книга"}</p>
              {currentChapter && (
                <p className="text-xs opacity-60 line-clamp-1">{currentChapter.title}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <Button variant={tocOpen ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => { setSettingsOpen(false); setTocOpen((v) => !v); }}>
              <List className="w-4 h-4" />
            </Button>

            <Button variant={settingsOpen ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => { setTocOpen(false); setSettingsOpen((v) => !v); }}>
              <Settings className="w-4 h-4" />
            </Button>

            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleFullscreen} title={isFullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}>
              {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            </Button>
          </div>
        </div>

        {tocOpen && (
          <div ref={tocPanelRef} className="fixed right-2 top-14 z-50 w-[calc(100vw-1rem)] max-w-xs rounded-xl border bg-background text-foreground shadow-xl sm:right-4 sm:max-w-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">Содержание</h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTocOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            <ScrollArea className="max-h-[calc(100vh-7rem)] p-2">
              <div className="space-y-0.5 pr-2">
                {chapters.map((ch, idx) => {
                  const isActive = idx === currentChapterIdx;
                  return (
                    <button
                      key={ch.id}
                      ref={isActive ? tocActiveChapterRef : undefined}
                      onClick={() => { navigateToChapterIndex(idx); setTocOpen(false); }}
                      className={cn(
                        "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground font-medium"
                          : "hover:bg-muted"
                      )}
                    >
                      <span className="text-xs opacity-60 block">Глава {idx + 1}</span>
                      {ch.title}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        )}

        {settingsOpen && (
          <div ref={settingsPanelRef} className="fixed right-2 top-14 z-50 w-[calc(100vw-1rem)] max-w-xs rounded-xl border bg-background text-foreground shadow-xl sm:right-4 sm:max-w-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">Настройки чтения</h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettingsOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            <ScrollArea className="max-h-[calc(100vh-7rem)]">
              <div className="p-4 space-y-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Тема</p>
                  <div className="flex gap-2">
                    {(["light", "sepia", "dark"] as const).map((tTheme) => (
                      <button
                        key={tTheme}
                        onClick={() => { setTheme(tTheme); persistSettings({ theme: tTheme }); }}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors",
                          tTheme === "light" ? "bg-white text-gray-900" : tTheme === "sepia" ? "bg-amber-50 text-amber-900" : "bg-gray-900 text-gray-100",
                          theme === tTheme ? "ring-2 ring-primary border-primary" : "border-gray-200"
                        )}
                      >
                        {tTheme === "light" ? "Светлая" : tTheme === "sepia" ? "Сепия" : "Тёмная"}
                      </button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Размер шрифта</p>
                    <span className="text-sm text-muted-foreground">{fontSize}px</span>
                  </div>
                  <Slider
                    min={12} max={32} step={1}
                    value={[fontSize]}
                    onValueChange={([v]) => { setFontSize(v); persistSettings({ fontSize: v }); }}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Межстрочный интервал</p>
                    <span className="text-sm text-muted-foreground">{lineHeight}×</span>
                  </div>
                  <Slider
                    min={1.2} max={2.5} step={0.1}
                    value={[lineHeight]}
                    onValueChange={([v]) => { setLineHeight(v); persistSettings({ lineHeight: v }); }}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Ширина текста</p>
                    <span className="text-sm text-muted-foreground">{contentWidth}%</span>
                  </div>
                  <Slider
                    min={50} max={95} step={1}
                    value={[contentWidth]}
                    onValueChange={([v]) => { setContentWidth(v); persistSettings({ contentWidth: v }); }}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Шрифт</p>
                  <Select value={fontFamily} onValueChange={(v) => { setFontFamily(v); persistSettings({ fontFamily: v }); }}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONTS.map((f) => (
                        <SelectItem key={f} value={f} style={{ fontFamily: f }}>{f}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}

        <div ref={contentRef} className="flex-1 overflow-y-auto">
          <div
            ref={contentAreaRef}
            className="mx-auto px-4 py-8 sm:px-6 sm:py-10 md:px-8"
            style={{ width: `${contentWidth}%` }}
          >
            {chapterLoading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin opacity-40" />
              </div>
            ) : chapterContent ? (
              <>
                <h2
                  className="text-xl font-bold mb-8 text-center opacity-80"
                  style={{ fontFamily, fontSize: fontSize + 4 }}
                >
                  {chapterContent.title}
                </h2>
                <div
                  className="prose prose-base sm:prose-lg max-w-none break-words"
                  style={{
                    fontFamily,
                    fontSize,
                    lineHeight,
                    color: "inherit",
                  }}
                  dangerouslySetInnerHTML={{ __html: chapterContent.htmlContent ?? "" }}
                />
              </>
            ) : chapters.length === 0 ? (
              <div className="text-center py-20 opacity-60">
                <BookOpen className="w-12 h-12 mx-auto mb-4" />
                <p>В этой книге нет глав</p>
              </div>
            ) : null}
          </div>
        </div>

        <div className={cn("sticky bottom-0 z-40 border-t flex items-center justify-between px-4 h-12 gap-4", t.ui, theme === "dark" ? "border-gray-700" : "border-gray-200")}>
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={goToPrevChapter}
            disabled={currentChapterIdx === 0}
          >
            <ChevronLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Предыдущая</span>
          </Button>

          <p className="text-sm opacity-60">
            {currentChapterIdx + 1} / {chapters.length}
          </p>

          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={goToNextChapter}
            disabled={currentChapterIdx >= chapters.length - 1}
          >
            <span className="hidden sm:inline">Следующая</span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </ProtectedRoute>
  );
}
