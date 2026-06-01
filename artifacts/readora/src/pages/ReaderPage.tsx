import { useState, useEffect, useRef, useCallback } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetBook,
  useListChapters,
  useGetChapter,
  useGetProgress,
  useSaveProgress,
  useSaveReaderSettings,
  ReaderSettingsInputTheme,
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
type DeviceMode = "desktop" | "mobile";

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

  // Local reader settings
  const [fontSize, setFontSize] = useState(18);
  const [fontFamily, setFontFamily] = useState("Georgia");
  const [lineHeight, setLineHeight] = useState(1.7);
  const [theme, setTheme] = useState<"light" | "sepia" | "dark">("light");
  const [contentWidth, setContentWidth] = useState(80);

  const contentRef = useRef<HTMLDivElement>(null);
  const readerRootRef = useRef<HTMLDivElement>(null);
  const tocPanelRef = useRef<HTMLDivElement>(null);
  const settingsPanelRef = useRef<HTMLDivElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSpaceScrollAtRef = useRef(0);

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
    if (settings) {
      setFontSize(settings.fontSize ?? 18);
      setFontFamily(settings.fontFamily ?? "Georgia");
      setLineHeight(settings.lineHeight ?? 1.7);
      setTheme((settings.theme as "light" | "sepia" | "dark") ?? "light");
      setContentWidth(settings.contentWidth ?? (deviceMode === "mobile" ? 95 : 80));
    }
  }, [settings, deviceMode]);

  // Restore progress
  useEffect(() => {
    if (progress?.currentChapterId && chapters.length > 0) {
      const idx = chapters.findIndex((c) => c.id === progress.currentChapterId);
      if (idx >= 0) setCurrentChapterIdx(idx);
    }
  }, [progress, chapters]);

  const currentChapter = chapters[currentChapterIdx];
  const { data: chapterContent, isLoading: chapterLoading } = useGetChapter(
    bookId,
    currentChapter?.id ?? 0,
    { query: { queryKey: getGetChapterQueryKey(bookId, currentChapter?.id ?? 0), enabled: !!currentChapter } }
  );

  // Save progress with debounce
  const triggerSave = useCallback(() => {
    if (!currentChapter) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const pct = ((currentChapterIdx + 1) / Math.max(chapters.length, 1)) * 100;
      saveProgress({
        id: bookId,
        data: {
          currentChapterId: currentChapter.id,
          progressPercent: pct,
          readingStatus: pct >= 99 ? "finished" : "reading",
        },
      }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetProgressQueryKey(bookId) });
        },
      });
    }, 2000);
  }, [currentChapter, currentChapterIdx, chapters.length, bookId]);

  useEffect(() => {
    triggerSave();
    // Scroll to top on chapter change
    contentRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [currentChapterIdx]);

  const goToPrevChapter = useCallback(() => {
    setCurrentChapterIdx((i) => Math.max(0, i - 1));
  }, []);

  const goToNextChapter = useCallback(() => {
    setCurrentChapterIdx((i) => Math.min(chapters.length - 1, i + 1));
  }, [chapters.length]);

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
        {/* Top bar */}
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
            {/* TOC */}
            <Button variant={tocOpen ? "secondary" : "ghost"} size="icon" className="h-8 w-8" onClick={() => { setSettingsOpen(false); setTocOpen((v) => !v); }}>
              <List className="w-4 h-4" />
            </Button>

            {/* Settings */}
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
                {chapters.map((ch, idx) => (
                  <button
                    key={ch.id}
                    onClick={() => { setCurrentChapterIdx(idx); setTocOpen(false); }}
                    className={cn(
                      "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors",
                      idx === currentChapterIdx
                        ? "bg-primary text-primary-foreground font-medium"
                        : "hover:bg-muted"
                    )}
                  >
                    <span className="text-xs opacity-60 block">Глава {idx + 1}</span>
                    {ch.title}
                  </button>
                ))}
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
                  {/* Theme */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Тема</p>
                    <div className="flex gap-2">
                      {(["light", "sepia", "dark"] as const).map((t) => (
                        <button
                          key={t}
                          onClick={() => { setTheme(t); persistSettings({ theme: t }); }}
                          className={cn(
                            "flex-1 py-2 rounded-lg text-sm font-medium border transition-colors",
                            t === "light" ? "bg-white text-gray-900" : t === "sepia" ? "bg-amber-50 text-amber-900" : "bg-gray-900 text-gray-100",
                            theme === t ? "ring-2 ring-primary border-primary" : "border-gray-200"
                          )}
                        >
                          {t === "light" ? "Светлая" : t === "sepia" ? "Сепия" : "Тёмная"}
                        </button>
                      ))}
                    </div>
                  </div>

                  <Separator />

                  {/* Font size */}
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

                  {/* Line height */}
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

                  {/* Content width */}
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

                  {/* Font family */}
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

        {/* Reader content */}
        <div
          ref={contentRef}
          className="flex-1 overflow-y-auto"
        >
          <div
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

        {/* Bottom navigation */}
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
