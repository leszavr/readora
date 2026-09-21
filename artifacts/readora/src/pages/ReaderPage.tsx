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
  Bookmark,
  Trash2,
  StickyNote,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

import {
  createReaderProgressPayload,
  createSemanticProgressPayload,
  type ReaderProgressPayload,
} from "@/components/reader/core/reader-progress-core";
import {
  restoreReaderScrollPosition,
  useDebouncedReaderProgressSave,
  useRestoreReaderScroll,
  usePeriodicProgressSave,
} from "@/components/reader/core/use-reader-progress-sync";
import {
  captureSemanticPosition,
  captureTextSelectionAnchor,
  findTextRangeByText,
  restoreTextSelectionAnchor,
  showTextSelectionHighlight,
  type TextSelectionAnchor,
  restoreSemanticPosition,
} from "@/components/reader/core/reader-text-anchor";
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
import {
  trackChapterOpened,
  trackProgressSyncFinished,
  trackReaderSessionEnded,
  trackReaderSessionStarted,
  trackReadingProgressed,
} from "@/lib/analytics";
import { useBookmarks, useCreateBookmark, useDeleteBookmark } from "@/hooks/use-bookmarks";
import { useNotes, useCreateNote, useUpdateNote, useDeleteNote } from "@/hooks/use-notes";
import { NotesPanel } from "@/components/reader/NotesPanel";
import { TextSelectionToolbar } from "@/components/reader/TextSelectionToolbar";

const FONTS = ["Georgia", "Arial", "Times New Roman", "Verdana", "Palatino"];

type DeviceMode = "desktop" | "mobile";
type ChapterNavigationSource = "toc" | "next_chapter" | "prev_chapter" | "restore";

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

interface NotePositionData {
  textSelection?: TextSelectionAnchor;
}

function parseNotePosition(raw: string): NotePositionData {
  try {
    const parsed = JSON.parse(raw) as NotePositionData;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// usePersistProgressOnUnmount — saves to localStorage + keepalive fetch on exit
// ---------------------------------------------------------------------------
function usePersistProgressOnUnmount({
  scrollContainerRef,
  contentAreaRef,
  chapters,
  currentChapterId,
  currentChapterIdx,
  contentLoading,
  bookId,
}: {
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  contentAreaRef: RefObject<HTMLDivElement | null>;
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

      // Используем семантическое позиционирование (v2) при сохранении при закрытии
      const contentArea = contentAreaRef.current;
      let payload: ReaderProgressPayload;
      
      if (contentArea) {
        const semanticPosition = captureSemanticPosition({
          chapterId: chId,
          scrollContainer: container,
          contentArea,
          viewportInset: 8,
        });
        
        if (semanticPosition) {
          payload = createSemanticProgressPayload({
            chapterId: chId,
            chapterIndex: chIdx,
            totalChapters: chs.length,
            semanticPosition,
          });
        } else {
          // Fallback к legacy
          payload = createReaderProgressPayload({
            chapterId: chId,
            chapterIndex: chIdx,
            totalChapters: chs.length,
            scrollTop: container.scrollTop,
            scrollHeight: container.scrollHeight,
            clientHeight: container.clientHeight,
          });
        }
      } else {
        // Fallback к legacy если нет contentArea
        payload = createReaderProgressPayload({
          chapterId: chId,
          chapterIndex: chIdx,
          totalChapters: chs.length,
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
        });
      }

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
  const [bookmarksOpen, setBookmarksOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [readerSessionEpoch, setReaderSessionEpoch] = useState(0);
  const [pendingScrollRestore, setPendingScrollRestore] =
    useState<PendingScrollRestore | null>(null);
  const [pendingNoteHighlight, setPendingNoteHighlight] = useState<{
    chapterId: number;
    anchor: TextSelectionAnchor | null;
    text: string | null;
  } | null>(null);
  const noteHighlightCleanupRef = useRef<(() => void) | null>(null);
  
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
  const bookmarksPanelRef = useRef<HTMLDivElement>(null);
  const notesPanelRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const tocActiveChapterRef = useRef<HTMLButtonElement | null>(null);
  const manualRestoreCleanupRef = useRef<(() => void) | null>(null);
  const programmaticScrollUntilRef = useRef(0);
  const readerSessionRef = useRef<{ startProgressPct: number; maxProgressPct: number; activeReadingMs: number; lastActiveAt: number; interacted: boolean; ended: boolean } | null>(null);
  const progressAnalyticsRef = useRef({ progressPct: -1, sentAt: 0, activeAt: 0 });
  const chapterNavigationSourceRef = useRef<ChapterNavigationSource>("restore");
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

  useEffect(() => {
    if (chapterLoading || !chapterContent || readerSessionRef.current) return;
    const startProgressPct = remoteProgress?.progressPercent ?? 0;
    const session = { startProgressPct, maxProgressPct: startProgressPct, activeReadingMs: 0, lastActiveAt: Date.now(), interacted: false, ended: false };
    readerSessionRef.current = session;
    trackReaderSessionStarted(bookId, startProgressPct);

    const markActive = () => {
      if (session.ended) {
        readerSessionRef.current = null;
        setReaderSessionEpoch((epoch) => epoch + 1);
        return;
      }
      session.interacted = true;
      session.lastActiveAt = Date.now();
    };
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (document.visibilityState === "visible" && session.interacted && now - session.lastActiveAt <= 60_000) {
        session.activeReadingMs += 1_000;
      }
    }, 1_000);
    const end = (endReason: "hidden" | "unmount" | "inactive") => {
      if (session.ended) return;
      session.ended = true;
      const endProgressPct = Math.max(0, Math.min(100, progressAnalyticsRef.current.progressPct >= 0 ? progressAnalyticsRef.current.progressPct : startProgressPct));
      trackReaderSessionEnded(bookId, startProgressPct, endProgressPct, Math.max(session.maxProgressPct, endProgressPct), session.activeReadingMs, endReason);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        end("hidden");
      } else if (session.ended) {
        readerSessionRef.current = null;
        setReaderSessionEpoch((epoch) => epoch + 1);
      }
    };
    const inactivityTimer = window.setInterval(() => {
      if (session.interacted && Date.now() - session.lastActiveAt > 60_000) end("inactive");
    }, 5_000);
    window.addEventListener("pointerdown", markActive, { passive: true });
    window.addEventListener("keydown", markActive);
    window.addEventListener("touchstart", markActive, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      end("unmount");
      window.clearInterval(timer);
      window.clearInterval(inactivityTimer);
      window.removeEventListener("pointerdown", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("touchstart", markActive);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [bookId, chapterContent, chapterLoading, readerSessionEpoch, remoteProgress?.progressPercent]);

  useEffect(() => {
    if (currentChapterIdx === null || chapterLoading || !chapterContent) return;
    trackChapterOpened(bookId, currentChapterIdx, chapterNavigationSourceRef.current);
  }, [bookId, chapterContent, chapterLoading, currentChapterIdx]);

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
      // Определяем версию позиции для логирования
      const isSemantic = payload.currentPosition.includes('"version":2');
      
      console.log('[ReaderPage] Saving progress:', {
        chapterId: payload.currentChapterId,
        progressPercent: payload.progressPercent,
        positionVersion: isSemantic ? 'v2 (semantic)' : 'v1 (legacy)',
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
      const syncStartedAt = Date.now();
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
              const now = Date.now();
              const syncDurationMs = Math.max(0, now - syncStartedAt);
              const progressPct = saved.progressPercent ?? payload.progressPercent;
              const analytics = progressAnalyticsRef.current;
              const session = readerSessionRef.current;
              if (session) session.maxProgressPct = Math.max(session.maxProgressPct, progressPct);
              if (analytics.progressPct < 0 || now - analytics.sentAt >= 30_000 || Math.abs(progressPct - analytics.progressPct) >= 5) {
                trackReadingProgressed(bookId, Math.max(0, currentChapterIdx ?? 0), progressPct, Math.max(0, now - (analytics.activeAt || syncStartedAt)));
                progressAnalyticsRef.current = { progressPct, sentAt: now, activeAt: now };
              }
              trackProgressSyncFinished("success", syncDurationMs);
            }
            callbacks?.onSuccess?.();
          },
          onError: (err) => {
            console.error('[ReaderPage] Progress save error:', err);
            trackProgressSyncFinished("error", Math.max(0, Date.now() - syncStartedAt));
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
  // Debounced save on scroll (with semantic positioning v2)
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
      useSemanticPosition: true, // Включаем семантическое позиционирование v2
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
  // Bookmarks & Notes
  // ---------------------------------------------------------------------------
  const { data: bookmarks = [] } = useBookmarks(bookId);
  const createBookmark = useCreateBookmark(bookId);
  const deleteBookmark = useDeleteBookmark(bookId);

  const { data: notes = [] } = useNotes(bookId);
  const createNote = useCreateNote(bookId);
  const updateNote = useUpdateNote(bookId);
  const deleteNote = useDeleteNote(bookId);

  const handleAddBookmark = useCallback(() => {
    if (currentChapterId === null) return;
    const container = scrollContainerRef.current;
    const contentArea = contentAreaRef.current;
    let positionRaw: string | null = null;
    let selectedText: string | null = null;

    // Захват выделенного текста
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && contentArea && contentArea.contains(selection.anchorNode)) {
      selectedText = selection.toString().trim().slice(0, 100) || null;
    }

    if (container && contentArea) {
      const pos = captureSemanticPosition({ chapterId: currentChapterId, scrollContainer: container, contentArea, viewportInset: 8 });
      if (pos) positionRaw = JSON.stringify(pos);
    }
    if (!positionRaw) {
      positionRaw = JSON.stringify({ chapterId: currentChapterId, version: 1, scrollTop: container?.scrollTop ?? 0 });
    }
    
    createBookmark.mutate({ chapterId: currentChapterId, positionRaw, selectedText }, {
      onSuccess: () => {
        // Показываем уведомление или тост (опционально)
      }
    });
  }, [currentChapterId, createBookmark]);

  const handleAddNote = useCallback(() => {
    if (currentChapterId === null) return;
    const container = scrollContainerRef.current;
    const contentArea = contentAreaRef.current;
    let positionRaw: string | null = null;
    let highlightedText: string | null = null;

    // Захват выделенного текста
    const selection = window.getSelection();
    const selectionAnchor = contentArea ? captureTextSelectionAnchor(selection, contentArea) : null;
    if (selection && !selection.isCollapsed && contentArea && contentArea.contains(selection.anchorNode)) {
      highlightedText = selectionAnchor?.selectedText ?? (selection.toString().trim().slice(0, 100) || null);
    }

    if (container && contentArea) {
      const pos = captureSemanticPosition({ chapterId: currentChapterId, scrollContainer: container, contentArea, viewportInset: 8 });
      if (pos) positionRaw = JSON.stringify(pos);
    }
    if (!positionRaw) {
      positionRaw = JSON.stringify({ chapterId: currentChapterId, version: 1, scrollTop: container?.scrollTop ?? 0 });
    }

    if (selectionAnchor) {
      try {
        const position = JSON.parse(positionRaw) as Record<string, unknown>;
        position.textSelection = selectionAnchor;
        positionRaw = JSON.stringify(position);
      } catch {
        // Оставляем базовую позицию, если старый формат нельзя расширить.
      }
    }

    const noteText = prompt("Введите текст заметки:");
    if (!noteText || !noteText.trim()) return;

    createNote.mutate({ chapterId: currentChapterId, positionRaw, highlightedText, noteText: noteText.trim(), color: "yellow" }, {
      onSuccess: () => {
        // Открываем панель заметок после создания
        setNotesOpen(true);
      }
    });
  }, [currentChapterId, createNote]);

  // ---------------------------------------------------------------------------
  // Chapter navigation
  // ---------------------------------------------------------------------------
  const navigateToChapterIndex = useCallback(
    (nextIdx: number, options?: { positionRaw?: string; navigationSource?: ChapterNavigationSource }) => {
      if (!chapters.length) return;

      const bounded = Math.max(0, Math.min(chapters.length - 1, nextIdx));
      
      // Фикс: если переходим на ту же главу с positionRaw — обновляем только позицию
      if (currentChapterIdx !== null && bounded === currentChapterIdx && options?.positionRaw) {
        const boundedChapterId = chapters[bounded]?.id;
        if (boundedChapterId) {
          setPendingScrollRestore({
            chapterId: boundedChapterId,
            positionRaw: options.positionRaw,
          });
        }
        return;
      }
      
      if (currentChapterIdx !== null && bounded === currentChapterIdx) return;

      // Save current chapter progress before navigating
      if (currentChapterIdx !== null) {
        saveProgressNow({
          chapterId: chapters[currentChapterIdx]?.id,
          chapterIdx: currentChapterIdx,
        });
      }

      setPendingScrollRestore(null);
      chapterNavigationSourceRef.current = options?.navigationSource ?? "toc";
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
    setBookmarksOpen(false);
    setNotesOpen(false);
  }, []);

  useReaderPanelsAutoclose({
    isOpen: tocOpen || settingsOpen || bookmarksOpen || notesOpen,
    onClose: closeAllPanels,
    contentRef: scrollElementRef,
    protectedRefs: [tocPanelRef, bookmarksPanelRef, notesPanelRef, settingsPanelRef],
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
    contentAreaRef,
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

  useEffect(() => {
    if (!pendingNoteHighlight || chapterLoading || currentChapterId !== pendingNoteHighlight.chapterId) return;

    noteHighlightCleanupRef.current?.();
    noteHighlightCleanupRef.current = null;

    const timer = window.setTimeout(() => {
      const contentArea = contentAreaRef.current;
      if (!contentArea) return;

      const range = pendingNoteHighlight.anchor
        ? restoreTextSelectionAnchor(pendingNoteHighlight.anchor, contentArea)
        : pendingNoteHighlight.text
          ? findTextRangeByText(contentArea, pendingNoteHighlight.text)
          : null;

      if (range) {
        noteHighlightCleanupRef.current = showTextSelectionHighlight(range, scrollContainerRef.current);
        const cleanup = noteHighlightCleanupRef.current;
        window.setTimeout(() => {
          if (noteHighlightCleanupRef.current === cleanup) {
            cleanup();
            noteHighlightCleanupRef.current = null;
          }
        }, 3_000);
        range.getBoundingClientRect();
      }
      setPendingNoteHighlight(null);
    }, 450);

    return () => window.clearTimeout(timer);
  }, [chapterLoading, currentChapterId, pendingNoteHighlight]);

  useEffect(() => () => noteHighlightCleanupRef.current?.(), []);

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
          navigateToChapterIndex(currentChapterIdx - 1, { navigationSource: "prev_chapter" });
        }
        return;
      }

      if (event.key === "ArrowRight" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        if (currentChapterIdx !== null && currentChapterIdx < chapters.length - 1 && isAtChapterEnd) {
          navigateToChapterIndex(currentChapterIdx + 1, { navigationSource: "next_chapter" });
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

    chapterNavigationSourceRef.current = "restore";
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
      chapterNavigationSourceRef.current = "restore";
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
                setBookmarksOpen(false);
                setNotesOpen(false);
                setTocOpen((v) => !v);
              }}
            >
              <List className="w-4 h-4" />
            </Button>

            <Button
              variant={bookmarksOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 relative"
              onClick={() => {
                setTocOpen(false);
                setSettingsOpen(false);
                setNotesOpen(false);
                setBookmarksOpen((v) => !v);
              }}
              title="Закладки"
              aria-label="Закладки"
            >
              <Bookmark className="w-4 h-4" />
              {bookmarks.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] leading-none rounded-full min-w-4 h-4 flex items-center justify-center px-0.5">
                  {bookmarks.length}
                </span>
              )}
            </Button>

            <Button
              variant={notesOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8 relative"
              onClick={() => {
                setTocOpen(false);
                setSettingsOpen(false);
                setBookmarksOpen(false);
                setNotesOpen((v) => !v);
              }}
              title="Заметки"
              aria-label="Заметки"
            >
              <StickyNote className="w-4 h-4" />
              {notes.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-primary-foreground text-[10px] leading-none rounded-full min-w-4 h-4 flex items-center justify-center px-0.5">
                  {notes.length}
                </span>
              )}
            </Button>

            <Button
              variant={settingsOpen ? "secondary" : "ghost"}
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setTocOpen(false);
                setBookmarksOpen(false);
                setNotesOpen(false);
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
                        navigateToChapterIndex(idx, { navigationSource: "toc" });
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

        {/* Bookmarks panel */}
        {bookmarksOpen && (
          <div
            ref={bookmarksPanelRef}
            className="fixed right-2 top-14 z-50 flex h-[calc(100vh-4rem)] w-[calc(100vw-1rem)] max-w-xs flex-col overflow-hidden rounded-xl border bg-background text-foreground shadow-xl sm:right-4 sm:max-w-sm"
          >
            <div className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">Закладки</h2>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setBookmarksOpen(false)}>
                <X className="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 overscroll-contain p-2">
              <div className="space-y-1 pr-2">
                {bookmarks.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Нет закладок. Выделите текст в книге — появится меню для создания закладки.</p>
                ) : (
                  bookmarks.map((bm) => {
                    const chIdx = chapters.findIndex((c) => c.id === bm.chapterId);
                    const chTitle = chIdx >= 0 ? chapters[chIdx].title : `Глава ${bm.chapterId}`;
                    return (
                      <div key={bm.id} className="flex items-center gap-1 rounded-lg hover:bg-muted px-2 py-2">
                        <button
                          className="flex-1 text-left"
                          onClick={() => {
                            if (chIdx >= 0) navigateToChapterIndex(chIdx, { positionRaw: bm.positionRaw });
                            setBookmarksOpen(false);
                          }}
                        >
                          <span className="text-xs opacity-60 block">{chIdx >= 0 ? `Глава ${chIdx + 1}` : ""} {chTitle}</span>
                          {bm.selectedText && (
                            <p className="text-sm italic text-muted-foreground line-clamp-2 mt-0.5">«{bm.selectedText}»</p>
                          )}
                          {bm.label && <span className="text-sm line-clamp-1">{bm.label}</span>}
                          <span className="text-xs text-muted-foreground">{new Date(bm.createdAt).toLocaleDateString("ru-RU")}</span>
                        </button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => deleteBookmark.mutate(bm.id)} aria-label="Удалить закладку">
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>
        )}

        {/* Notes panel */}
        {notesOpen && (
          <NotesPanel
            notes={notes}
            chapters={chapters}
            onClose={() => setNotesOpen(false)}
            onNavigate={(chIdx, posRaw, highlightedText) => {
              const position = parseNotePosition(posRaw);
              setPendingNoteHighlight({
                chapterId: chapters[chIdx]?.id ?? 0,
                anchor: position.textSelection ?? null,
                text: highlightedText,
              });
              navigateToChapterIndex(chIdx, { positionRaw: posRaw });
              setNotesOpen(false);
            }}
            onDelete={(noteId) => deleteNote.mutate(noteId)}
            onUpdate={(noteId, noteText, color) => updateNote.mutate({ noteId, noteText, color })}
          />
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
          style={{
            colorScheme: theme === "dark" ? "dark" : "light",
            scrollbarColor:
              theme === "dark"
                ? "#4b5563 #1f2937"
                : theme === "sepia"
                  ? "#d6b98c #fef3c7"
                  : "#cbd5e1 #ffffff",
          }}
          onScroll={scheduleProgressSave}
          onContextMenu={(event) => event.preventDefault()}
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

        {/* Text Selection Toolbar */}
        <TextSelectionToolbar
          containerRef={contentAreaRef}
          onAddBookmark={handleAddBookmark}
          onAddNote={handleAddNote}
        />

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
            onClick={() => navigateToChapterIndex(currentChapterIdx - 1, { navigationSource: "prev_chapter" })}
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
            onClick={() => navigateToChapterIndex(currentChapterIdx + 1, { navigationSource: "next_chapter" })}
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
