import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type RefObject,
} from "react";
import { useRoute, useLocation, Link } from "wouter";
import {
  useGetBook,
  useListChapters,
  useGetChapter,
  useGetProgress,
  useSaveProgress,
  ReaderSettingsInputTheme,
  getGetProgressQueryKey,
} from "@workspace/api-client-react";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft,
  List,
  Settings,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Loader2,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

import {
  createReaderProgressPayload,
  type ReaderProgressPayload,
} from "@/components/reader/core/reader-progress-core";
import {
  restoreReaderScrollPosition,
  useDebouncedReaderProgressSave,
  useRestoreReaderScroll,
  usePeriodicProgressSave,
} from "@/components/reader/core/use-reader-progress-sync";
import { useReaderSyncState } from "@/components/reader/core/use-reader-sync-state";
import { useReaderPanelsAutoclose } from "@/components/reader/core/use-reader-panels-autoclose";
import { useSmoothReaderSpaceScroll } from "@/components/reader/core/use-smooth-reader-space-scroll";
import { usePreserveReaderVisualAnchor } from "@/components/reader/core/use-preserve-reader-visual-anchor";
import { ReaderProgressIndicators } from "@/components/reader/ReaderProgressIndicators";
import {
  loadReaderProgressFromStorage,
  saveReaderProgressToStorage,
  getFreshestReaderProgress,
} from "@/lib/reader-local-progress";
import {
  loadReaderSettingsFromStorage,
  saveReaderSettingsToStorage,
  mergeSettings,
  type ReaderLocalSettings,
} from "@/lib/reader-local-settings";

const FONTS = ["Georgia", "Arial", "Times New Roman", "Verdana", "Palatino"];

type DeviceMode = "desktop" | "mobile";

function getDeviceMode(): DeviceMode {
  if (typeof window === "undefined") return "desktop";
  return window.matchMedia("(pointer: coarse), (max-width: 767px)").matches
    ? "mobile"
    : "desktop";
}

async function fetchReaderSettings(deviceMode: DeviceMode) {
  const res = await fetch(`/api/reader/settings?deviceMode=${deviceMode}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Не удалось загрузить настройки ридера");
  return res.json() as Promise<{
    fontSize: number;
    fontFamily: string;
    lineHeight: number;
    theme: "light" | "sepia" | "dark";
    contentWidth: number;
  }>;
}

interface PendingScrollRestore {
  chapterId: number;
  positionRaw: string;
}

// ---------------------------------------------------------------------------
// usePersistProgressOnUnmount — saves to localStorage + keepalive fetch on exit
// ---------------------------------------------------------------------------
function usePersistProgressOnUnmount({
  scrollContainerRef,
  chapters,
  currentChapterId,
  currentChapterIdx,
  contentLoading,
  bookId,
}: {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  chapters: Array<{ id: number }>;
  currentChapterId: number | null;
  currentChapterIdx: number | null;
  contentLoading: boolean;
  bookId: number;
}) {
  const contentLoadingRef = useRef(contentLoading);
  useEffect(() => {
    contentLoadingRef.current = contentLoading;
  }, [contentLoading]);

  const chaptersRef = useRef(chapters);
  useEffect(() => {
    chaptersRef.current = chapters;
  }, [chapters]);

  const currentChapterIdRef = useRef(currentChapterId);
  useEffect(() => {
    currentChapterIdRef.current = currentChapterId;
  }, [currentChapterId]);

  const currentChapterIdxRef = useRef(currentChapterIdx);
  useEffect(() => {
    currentChapterIdxRef.current = currentChapterIdx;
  }, [currentChapterIdx]);

  useEffect(() => {
    return () => {
      const container = scrollContainerRef.current;
      const chs = chaptersRef.current;
      const chId = currentChapterIdRef.current;
      const chIdx = currentChapterIdxRef.current;
      if (!container || !chs.length || chId === null || chIdx === null) return;
      if (contentLoadingRef.current) return;

      const payload = createReaderProgressPayload({
        chapterId: chId,
        chapterIndex: chIdx,
        totalChapters: chs.length,
        scrollTop: container.scrollTop,
        scrollHeight: container.scrollHeight,
        clientHeight: container.clientHeight,
      });

      // Save to localStorage for instant restore on next visit
      saveReaderProgressToStorage(
        { bookId },
        {
          currentChapterId: payload.currentChapterId,
          currentPosition: payload.currentPosition,
          progressPercent: payload.progressPercent,
        }
      );

      fetch(`/api/books/${bookId}/progress`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentChapterId: payload.currentChapterId,
          currentPosition: payload.currentPosition,
          progressPercent: payload.progressPercent,
          readingStatus: payload.progressPercent >= 99 ? "finished" : "reading",
        }),
        credentials: "include",
        keepalive: true,
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId, scrollContainerRef]);
}

// ---------------------------------------------------------------------------
// usePendingScrollRestore — fires a manual restore after chapter navigation
// ---------------------------------------------------------------------------
function usePendingScrollRestore({
  pendingScrollRestore,
  contentLoading,
  currentChapterId,
  scrollContainerRef,
  contentAreaRef,
  manualRestoreCleanupRef,
  setPendingScrollRestore,
}: {
  pendingScrollRestore: PendingScrollRestore | null;
  contentLoading: boolean;
  currentChapterId: number | null;
  scrollContainerRef: RefObject<HTMLElement | null>;
  contentAreaRef: RefObject<HTMLElement | null>;
  manualRestoreCleanupRef: RefObject<(() => void) | null>;
  setPendingScrollRestore: (restore: PendingScrollRestore | null) => void;
}) {
  useEffect(() => {
    return () => {
      manualRestoreCleanupRef.current?.();
    };
  }, [manualRestoreCleanupRef]);

  useEffect(() => {
    if (
      !pendingScrollRestore ||
      contentLoading ||
      currentChapterId !== pendingScrollRestore.chapterId
    ) {
      return;
    }

    manualRestoreCleanupRef.current?.();
    manualRestoreCleanupRef.current = restoreReaderScrollPosition({
      scrollContainerRef,
      contentAreaRef,
      currentChapterId,
      currentPositionRaw: pendingScrollRestore.positionRaw,
      delayMs: 120,
      retryAttempts: 5,
      retryDelayMs: 120,
    });
    setPendingScrollRestore(null);
  }, [
    contentLoading,
    currentChapterId,
    manualRestoreCleanupRef,
    pendingScrollRestore,
    scrollContainerRef,
    contentAreaRef,
    setPendingScrollRestore,
  ]);
}

// ---------------------------------------------------------------------------
// Main reader component
// ---------------------------------------------------------------------------
export default function ReaderPage() {
  const [location] = useLocation();
  const [, params] = useRoute("/reader/:id");
  const routeBookId = parseInt(params?.id ?? "0", 10);
  const locationBookIdMatch = location.match(/^\/reader\/(\d+)/);
  const locationBookId = locationBookIdMatch ? parseInt(locationBookIdMatch[1], 10) : 0;
  const bookId = Number.isFinite(routeBookId) && routeBookId > 0 ? routeBookId : locationBookId;
  const qc = useQueryClient();

  const { data: book } = useGetBook(bookId);
  const { data: chapters = [] } = useListChapters(bookId);
  const progressQuery = useGetProgress(bookId);
  const { data: remoteProgress } = progressQuery;

  const [deviceMode, setDeviceMode] = useState<DeviceMode>(() => getDeviceMode());
  const { data: settings } = useQuery({
    queryKey: ["reader-settings", deviceMode],
    queryFn: () => fetchReaderSettings(deviceMode),
    staleTime: 1000 * 60 * 5,
  });

  const { mutate: saveProgressMutate } = useSaveProgress();

  // Chapter navigation state — null while progress is loading
  const [currentChapterIdx, setCurrentChapterIdx] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [pendingScrollRestore, setPendingScrollRestore] =
    useState<PendingScrollRestore | null>(null);
  
  // Scroll position tracking for smart navigation
  const [isAtChapterStart, setIsAtChapterStart] = useState(true);
  const [isAtChapterEnd, setIsAtChapterEnd] = useState(false);

  // Debug: log button states
  useEffect(() => {
    console.log('[Reader] Button states:', {
      currentChapterIdx,
      totalChapters: chapters.length,
      isAtChapterStart,
      isAtChapterEnd,
      prevDisabled: currentChapterIdx === null || currentChapterIdx <= 0 || !isAtChapterStart,
      nextDisabled: currentChapterIdx === null || currentChapterIdx >= chapters.length - 1 || !isAtChapterEnd,
    });
  }, [currentChapterIdx, chapters.length, isAtChapterStart, isAtChapterEnd]);

  // Local reader settings (initialised from server settings below)
  const [fontSize, setFontSize] = useState(18);
  const [fontFamily, setFontFamily] = useState("Georgia");
  const [lineHeight, setLineHeight] = useState(1.7);
  const [theme, setTheme] = useState<"light" | "sepia" | "dark">("light");
  const [contentWidth, setContentWidth] = useState(80);

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const contentAreaRef = useRef<HTMLDivElement>(null);
  const readerRootRef = useRef<HTMLDivElement>(null);
  const tocPanelRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const tocActiveChapterRef = useRef<HTMLButtonElement | null>(null);
  const manualRestoreCleanupRef = useRef<(() => void) | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  // Note: removed hasInitializedChapterRef - using currentChapterIdx !== null as initialization check (voxlibris pattern)

  const scrollElementRef = scrollContainerRef as RefObject<HTMLElement | null>;

  // ---------------------------------------------------------------------------
  // Derived chapter values
  // ---------------------------------------------------------------------------
  const currentChapter = currentChapterIdx !== null ? chapters[currentChapterIdx] : undefined;
  const currentChapterId = currentChapter?.id ?? null;

  const { data: chapterContent, isLoading: chapterLoading } = useGetChapter(
    bookId,
    currentChapter?.id ?? 0
  );

  // ---------------------------------------------------------------------------
  // Use server-side progress as single source of truth (no localStorage)
  // ---------------------------------------------------------------------------

  // ---------------------------------------------------------------------------
  // Programmatic scroll guard
  // ---------------------------------------------------------------------------
  const setProgrammaticScroll = useCallback((holdMs: number) => {
    programmaticScrollUntilRef.current = Date.now() + holdMs;
  }, []);

  const isProgrammaticScroll = useCallback(() => {
    return Date.now() < programmaticScrollUntilRef.current;
  }, []);

  // ---------------------------------------------------------------------------
  // saveProgress adapter: ReaderProgressPayload → useSaveProgress mutation
  // ---------------------------------------------------------------------------
  const saveProgress = useCallback(
    (
      payload: ReaderProgressPayload,
      callbacks?: {
        onSuccess?: () => void;
        onError?: (error: unknown) => void;
      }
    ) => {
      console.log('[ReaderPage] Saving progress:', {
        chapterId: payload.currentChapterId,
        progressPercent: payload.progressPercent,
        positionLength: payload.currentPosition.length,
      });
      
      // Save to localStorage immediately for fast restore on next visit
      saveReaderProgressToStorage(
        { bookId },
        {
          currentChapterId: payload.currentChapterId,
          currentPosition: payload.currentPosition,
          progressPercent: payload.progressPercent,
        }
      );
      
      const readingStatus = payload.progressPercent >= 99 ? "finished" : "reading";
      saveProgressMutate(
        {
          id: bookId,
          data: {
            currentChapterId: payload.currentChapterId,
            currentPosition: payload.currentPosition,
            progressPercent: payload.progressPercent,
            readingStatus: readingStatus as "reading" | "finished",
          },
        },
        {
          onSuccess: (saved) => {
            console.log('[ReaderPage] Progress saved successfully:', {
              chapterId: saved?.currentChapterId,
              progressPercent: saved?.progressPercent,
            });
            if (saved) {
              qc.setQueryData(getGetProgressQueryKey(bookId), saved);
            }
            callbacks?.onSuccess?.();
          },
          onError: (err) => {
            console.error('[ReaderPage] Progress save error:', err);
            callbacks?.onError?.(err);
          },
        }
      );
    },
    [bookId, qc, saveProgressMutate]
  );

  // ---------------------------------------------------------------------------
  // Sync state tracking
  // ---------------------------------------------------------------------------
  const { saveWithSync, isLocalSessionProgress, isSyncing, syncError, lastSyncTime } =
    useReaderSyncState({ saveProgress });

  // ---------------------------------------------------------------------------
  // Debounced save on scroll
  // ---------------------------------------------------------------------------
  const { scheduleSave: scheduleProgressSave, saveNow: saveProgressNow } =
    useDebouncedReaderProgressSave({
      scrollContainerRef: scrollElementRef,
      contentAreaRef: contentAreaRef as RefObject<HTMLElement | null>,
      currentChapterId,
      currentChapterIdx,
      totalChapters: chapters.length,
      onSave: saveWithSync,
      debounceMs: 1500,
      enabled: currentChapterId !== null && chapters.length > 0,
    });

  // Periodic auto-save disabled - debounced save on scroll is enough
  // usePeriodicProgressSave({
  //   saveNow: saveProgressNow,
  //   intervalMs: 5000,
  //   enabled: currentChapterId !== null && chapters.length > 0,
  // });

  // ---------------------------------------------------------------------------
  // Restore scroll position when chapter content loads
  // ---------------------------------------------------------------------------
  useRestoreReaderScroll({
    scrollContainerRef: scrollElementRef,
    contentAreaRef: contentAreaRef as RefObject<HTMLElement | null>,
    currentChapterId,
    currentPositionRaw: remoteProgress?.currentPosition ?? null,
    contentReady: !chapterLoading,
    onProgrammaticScroll: setProgrammaticScroll,
    isProgrammaticScroll,
  });

  // ---------------------------------------------------------------------------
  // Chapter navigation
  // ---------------------------------------------------------------------------
  const navigateToChapterIndex = useCallback(
    (nextIdx: number, options?: { positionRaw?: string }) => {
      if (!chapters.length) return;

      const bounded = Math.max(0, Math.min(chapters.length - 1, nextIdx));
      if (currentChapterIdx !== null && bounded === currentChapterIdx) return;

      // Save current chapter progress before navigating
      if (currentChapterIdx !== null) {
        saveProgressNow({
          chapterId: chapters[currentChapterIdx]?.id,
          chapterIdx: currentChapterIdx,
        });
      }

      setPendingScrollRestore(null);
      setCurrentChapterIdx(bounded);
      setProgrammaticScroll(220);

      if (options?.positionRaw) {
        const boundedChapterId = chapters[bounded]?.id;
        if (boundedChapterId) {
          setPendingScrollRestore({
            chapterId: boundedChapterId,
            positionRaw: options.positionRaw,
          });
        }
      } else {
        setTimeout(() => {
          scrollContainerRef.current?.scrollTo({ top: 0, behavior: "auto" });
        }, 100);
      }
    },
    [chapters, currentChapterIdx, saveProgressNow, setProgrammaticScroll]
  );

  // ---------------------------------------------------------------------------
  // Visual anchor for settings changes (font/size etc.)
  // ---------------------------------------------------------------------------
  const preserveReaderVisualAnchor = usePreserveReaderVisualAnchor({
    scrollContainerRef: scrollElementRef,
    contentAreaRef: contentAreaRef as RefObject<HTMLElement | null>,
  });

  // ---------------------------------------------------------------------------
  // Panels autoclose
  // ---------------------------------------------------------------------------
  const closeAllPanels = useCallback(() => {
    setTocOpen(false);
    setSettingsOpen(false);
  }, []);

  useReaderPanelsAutoclose({
    isOpen: tocOpen || settingsOpen,
    onClose: closeAllPanels,
    contentRef: scrollElementRef,
    protectedRefs: [tocPanelRef, settingsPanelRef],
  });

  // ---------------------------------------------------------------------------
  // Smooth space scroll
  // ---------------------------------------------------------------------------
  useSmoothReaderSpaceScroll({
    scrollContainerRef: scrollElementRef,
    enabled: currentChapterId !== null,
  });

  // ---------------------------------------------------------------------------
  // Persist on unmount (localStorage + keepalive)
  // ---------------------------------------------------------------------------
  usePersistProgressOnUnmount({
    scrollContainerRef,
    chapters,
    currentChapterId,
    currentChapterIdx,
    contentLoading: chapterLoading,
    bookId,
  });

  // ---------------------------------------------------------------------------
  // Pending scroll restore (after chapter navigation with a saved position)
  // ---------------------------------------------------------------------------
  usePendingScrollRestore({
    pendingScrollRestore,
    contentLoading: chapterLoading,
    currentChapterId,
    scrollContainerRef: scrollElementRef,
    contentAreaRef: contentAreaRef as RefObject<HTMLElement | null>,
    manualRestoreCleanupRef,
    setPendingScrollRestore,
  });

  // ---------------------------------------------------------------------------
  // Scroll position tracking for smart navigation
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const SCROLL_THRESHOLD = 50; // pixels from top/bottom to consider at start/end

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const scrollBottom = scrollHeight - scrollTop - clientHeight;

      // User is at start only if scrolled to the very top
      const atStart = scrollTop <= SCROLL_THRESHOLD;
      // User is at end only if scrolled to the very bottom
      const atEnd = scrollBottom <= SCROLL_THRESHOLD;

      // Make states mutually exclusive: if not at start and not at end, both should be false
      // This prevents accidental navigation from the middle of the chapter
      const isStart = atStart && !atEnd;
      const isEnd = atEnd && !atStart;

      console.log('[Reader] Scroll position:', {
        scrollTop,
        scrollHeight,
        clientHeight,
        scrollBottom,
        atStart,
        atEnd,
        isStart,
        isEnd,
        currentChapterId,
      });

      setIsAtChapterStart(isStart);
      setIsAtChapterEnd(isEnd);
    };

    // Initial check
    handleScroll();

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => container.removeEventListener("scroll", handleScroll);
  }, [currentChapterId]); // Re-check when chapter changes

  // ---------------------------------------------------------------------------
  // Keyboard navigation (← → chapter switch)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          "input, textarea, select, button, a, [role='button'], [contenteditable='true']"
        )
      )
        return;

      if (event.key === "ArrowLeft" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        if (currentChapterIdx !== null && currentChapterIdx > 0 && isAtChapterStart) {
          navigateToChapterIndex(currentChapterIdx - 1);
        }
        return;
      }

      if (event.key === "ArrowRight" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        if (currentChapterIdx !== null && currentChapterIdx < chapters.length - 1 && isAtChapterEnd) {
          navigateToChapterIndex(currentChapterIdx + 1);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [chapters.length, currentChapterIdx, navigateToChapterIndex, isAtChapterStart, isAtChapterEnd]);

  // ---------------------------------------------------------------------------
  // Get effective progress (compare local and remote, pick freshest)
  // ---------------------------------------------------------------------------
  const effectiveProgress = useMemo(() => {
    if (progressQuery.isLoading) return null;
    
    const localProgress = loadReaderProgressFromStorage({ bookId });
    
    const normalizedRemote = remoteProgress?.currentChapterId
      ? {
          currentChapterId: remoteProgress.currentChapterId,
          currentPosition: remoteProgress.currentPosition ?? "",
          progressPercent: remoteProgress.progressPercent ?? 0,
        }
      : null;
    
    return getFreshestReaderProgress(normalizedRemote, localProgress);
  }, [bookId, remoteProgress, progressQuery.isLoading]);

  // ---------------------------------------------------------------------------
  // Initialise chapter from progress (voxlibris pattern: check currentChapterIdx !== null)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    // Skip if already initialized
    if (currentChapterIdx !== null) return;
    // Wait for chapters to load
    if (!chapters.length) return;
    // Wait for progress to be determined
    if (progressQuery.isLoading) return;

    let targetIdx = 0;
    if (effectiveProgress?.currentChapterId) {
      const idx = chapters.findIndex((c) => c.id === effectiveProgress.currentChapterId);
      if (idx >= 0) {
        targetIdx = idx;
      }
    }

    setCurrentChapterIdx(targetIdx);
  }, [chapters, effectiveProgress, progressQuery.isLoading, currentChapterIdx]);

  // ---------------------------------------------------------------------------
  // Reset on bookId change
  // ---------------------------------------------------------------------------
  const prevBookIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (prevBookIdRef.current === null) {
      prevBookIdRef.current = bookId;
      return;
    }

    if (prevBookIdRef.current !== bookId) {
      setCurrentChapterIdx(null);
      setPendingScrollRestore(null);
      prevBookIdRef.current = bookId;
    }
  }, [bookId]);

  // ---------------------------------------------------------------------------
  // Sync deviceMode on resize
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const update = () => setDeviceMode(getDeviceMode());
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Initialize settings from localStorage first, then merge with server settings
  // ---------------------------------------------------------------------------
  const [areSettingsInitialized, setAreSettingsInitialized] = useState(false);

  useEffect(() => {
    if (areSettingsInitialized) return;

    // Load local settings first (device-specific)
    const localSettings = loadReaderSettingsFromStorage(deviceMode);
    
    // Merge with server settings (local takes precedence if exists)
    const merged = mergeSettings(localSettings, settings ?? null, deviceMode);
    
    setFontSize(merged.fontSize);
    setFontFamily(merged.fontFamily);
    setLineHeight(merged.lineHeight);
    setTheme(merged.theme);
    setContentWidth(merged.contentWidth);
    
    setAreSettingsInitialized(true);
  }, [settings, deviceMode, areSettingsInitialized]);

  // ---------------------------------------------------------------------------
  // TOC scroll active chapter into view
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!tocOpen) return;
    const frame = requestAnimationFrame(() => {
      tocActiveChapterRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => cancelAnimationFrame(frame);
  }, [tocOpen, currentChapterIdx]);

  // ---------------------------------------------------------------------------
  // Fullscreen
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Settings persistence helper - saves to both localStorage and server
  // ---------------------------------------------------------------------------
  const persistSettings = useCallback(
    (
      partial: Partial<{
        fontSize: number;
        fontFamily: string;
        lineHeight: number;
        theme: ReaderSettingsInputTheme;
        contentWidth: number;
      }>
    ) => {
      const updated: ReaderLocalSettings = {
        fontSize: partial.fontSize ?? fontSize,
        fontFamily: partial.fontFamily ?? fontFamily,
        lineHeight: partial.lineHeight ?? lineHeight,
        theme: (partial.theme ?? theme) as ReaderLocalSettings["theme"],
        contentWidth: partial.contentWidth ?? contentWidth,
        _version: 1,
      };

      // Save to localStorage immediately (device-specific)
      saveReaderSettingsToStorage(updated);

      // Sync to server (for cross-device backup, but local takes precedence)
      // Use custom fetch to include deviceMode in query params
      fetch(`/api/reader/settings?deviceMode=${deviceMode}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fontSize: updated.fontSize,
          fontFamily: updated.fontFamily,
          lineHeight: updated.lineHeight,
          theme: updated.theme,
          contentWidth: updated.contentWidth,
        }),
        credentials: "include",
      }).catch(() => {
        // Ignore server errors - local settings take precedence
      });
    },
    [fontSize, fontFamily, lineHeight, theme, contentWidth, deviceMode]
  );

  // ---------------------------------------------------------------------------
  // Save settings to localStorage whenever they change (debounced)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!areSettingsInitialized) return;

    // Save to localStorage on every change for immediate persistence
    saveReaderSettingsToStorage({
      fontSize,
      fontFamily,
      lineHeight,
      theme,
      contentWidth,
    });
  }, [fontSize, fontFamily, lineHeight, theme, contentWidth, areSettingsInitialized]);

  // ---------------------------------------------------------------------------
  // Derived display values
  // ---------------------------------------------------------------------------
  const THEMES = {
    light: { bg: "bg-white", text: "text-gray-900", ui: "bg-gray-50" },
    sepia: { bg: "bg-amber-50", text: "text-amber-950", ui: "bg-amber-100/50" },
    dark: { bg: "bg-gray-900", text: "text-gray-100", ui: "bg-gray-800" },
  };
  const t = THEMES[theme];

  const userProgressSummary = useMemo(() => {
    if (!remoteProgress?.currentChapterId) return null;
    const idx = chapters.findIndex((c) => c.id === remoteProgress.currentChapterId);
    return {
      progress: remoteProgress.progressPercent ?? 0,
      currentChapter: idx >= 0 ? idx + 1 : 1,
    };
  }, [chapters, remoteProgress]);

  // ---------------------------------------------------------------------------
  // Loading state while chapter is being resolved
  // ---------------------------------------------------------------------------
  if (currentChapterIdx === null || progressQuery.isLoading) {
    return (
      <ProtectedRoute>
        <div className="flex items-center justify-center h-screen bg-background text-foreground">
          <Loader2 className="w-8 h-8 animate-spin opacity-40" />
        </div>
      </ProtectedRoute>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <ProtectedRoute>
      <div ref={readerRootRef} className={cn("h-screen flex flex-col", t.bg, t.text)}>

        {/* Header */}
        <div
          className={cn(
            "sticky top-0 z-40 border-b flex items-center justify-between px-4 h-12 gap-4",
            t.ui,
            theme === "dark" ? "border-gray-700" : "border-gray-200"
          )}
        >
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
            <Button
              variant={tocOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setSettingsOpen(false);
                setTocOpen((v) => !v);
              }}
            >
              <List className="w-4 h-4" />
            </Button>

            <Button
              variant={settingsOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setTocOpen(false);
                setSettingsOpen((v) => !v);
              }}
            >
              <Settings className="w-4 h-4" />
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleFullscreen}
              title={isFullscreen ? "Выйти из полноэкранного режима" : "Полноэкранный режим"}
            >
              {isFullscreen ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
            </Button>
          </div>
        </div>

        {/* TOC panel */}
        {tocOpen && (
          <div
            ref={tocPanelRef}
            className="fixed right-2 top-14 z-50 flex h-[calc(100vh-4rem)] w-[calc(100vw-1rem)] max-w-xs flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl sm:right-4 sm:max-w-sm"
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">Содержание</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setTocOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 overscroll-contain p-2">
              <div className="space-y-0.5 pr-2">
                {chapters.map((ch, idx) => {
                  const isActive = idx === currentChapterIdx;
                  return (
                    <button
                      key={ch.id}
                      ref={isActive ? tocActiveChapterRef : undefined}
                      onClick={() => {
                        navigateToChapterIndex(idx);
                        setTocOpen(false);
                      }}
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

        {/* Settings panel */}
        {settingsOpen && (
          <div
            ref={settingsPanelRef}
            className="fixed right-2 top-14 z-50 w-[calc(100vw-1rem)] max-w-xs rounded-xl border bg-background text-foreground shadow-xl sm:right-4 sm:max-w-sm"
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">Настройки чтения</h2>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setSettingsOpen(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="max-h-[calc(100vh-7rem)]">
              <div className="p-4 space-y-6">
                <div className="space-y-2">
                  <p className="text-sm font-medium">Тема</p>
                  <div className="flex gap-2">
                    {(["light", "sepia", "dark"] as const).map((tTheme) => (
                      <button
                        key={tTheme}
                        onClick={() => {
                          preserveReaderVisualAnchor(() => {
                            setTheme(tTheme);
                            persistSettings({ theme: tTheme });
                          });
                        }}
                        className={cn(
                          "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors",
                          tTheme === "light"
                            ? "bg-white text-gray-900"
                            : tTheme === "sepia"
                              ? "bg-amber-50 text-amber-900"
                              : "bg-gray-900 text-gray-100",
                          theme === tTheme
                            ? "ring-2 ring-primary border-primary"
                            : "border-gray-200"
                        )}
                      >
                        {tTheme === "light"
                          ? "Светлая"
                          : tTheme === "sepia"
                            ? "Сепия"
                            : "Тёмная"}
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
                    min={12}
                    max={32}
                    step={1}
                    value={[fontSize]}
                    onValueChange={([v]) => {
                      preserveReaderVisualAnchor(() => {
                        setFontSize(v);
                        persistSettings({ fontSize: v });
                      });
                    }}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Межстрочный интервал</p>
                    <span className="text-sm text-muted-foreground">{lineHeight}×</span>
                  </div>
                  <Slider
                    min={1.2}
                    max={2.5}
                    step={0.1}
                    value={[lineHeight]}
                    onValueChange={([v]) => {
                      preserveReaderVisualAnchor(() => {
                        setLineHeight(v);
                        persistSettings({ lineHeight: v });
                      });
                    }}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Ширина текста</p>
                    <span className="text-sm text-muted-foreground">{contentWidth}%</span>
                  </div>
                  <Slider
                    min={50}
                    max={95}
                    step={1}
                    value={[contentWidth]}
                    onValueChange={([v]) => {
                      preserveReaderVisualAnchor(() => {
                        setContentWidth(v);
                        persistSettings({ contentWidth: v });
                      });
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <p className="text-sm font-medium">Шрифт</p>
                  <Select
                    value={fontFamily}
                    onValueChange={(v) => {
                      preserveReaderVisualAnchor(() => {
                        setFontFamily(v);
                        persistSettings({ fontFamily: v });
                      });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FONTS.map((f) => (
                        <SelectItem key={f} value={f} style={{ fontFamily: f }}>
                          {f}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Scrollable content */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto"
          onScroll={scheduleProgressSave}
        >
          <div
            ref={contentAreaRef}
            className="reader-content-area mx-auto px-4 py-8 sm:px-6 sm:py-10 md:px-8"
            style={{ width: `${contentWidth}%` }}
          >
            {currentChapterIdx === null || progressQuery.isLoading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin opacity-40" />
              </div>
            ) : chapterLoading ? (
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
                  style={{ fontFamily, fontSize, lineHeight, color: "inherit" }}
                  dangerouslySetInnerHTML={{ __html: chapterContent.htmlContent ?? "" }}
                />
              </>
            ) : chapters.length === 0 ? (
              <div className="text-center py-20 opacity-60">
                <BookOpen className="w-12 h-12 mx-auto mb-4" />
                <p>В этой книге нет глав</p>
              </div>
            ) : (
              <div className="flex justify-center py-20 opacity-60">
                <p>Не удалось загрузить главу</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer navigation */}
        <div
          className={cn(
            "sticky bottom-0 z-40 border-t flex items-center justify-between px-4 h-12 gap-4",
            t.ui,
            theme === "dark" ? "border-gray-700" : "border-gray-200"
          )}
        >
          <Button
            variant="ghost"
            size="sm"
            className="gap-2"
            onClick={() => navigateToChapterIndex(currentChapterIdx - 1)}
            disabled={currentChapterIdx <= 0 || !isAtChapterStart}
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
            onClick={() => navigateToChapterIndex(currentChapterIdx + 1)}
            disabled={currentChapterIdx >= chapters.length - 1 || !isAtChapterEnd}
          >
            <span className="hidden sm:inline">Следующая</span>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>

        {/* Sync & progress indicators (bottom-left hover + top-right sync badge) */}
        <ReaderProgressIndicators
          isSyncing={isSyncing}
          lastSyncTime={lastSyncTime}
          error={syncError}
          userProgress={userProgressSummary ?? undefined}
        />
      </div>
    </ProtectedRoute>
  );
}
