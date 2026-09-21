import { BookmarkPlus, StickyNote } from "lucide-react";
import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  onAddBookmark: () => void;
  onAddNote: () => void;
  containerRef: React.RefObject<HTMLElement | null>;
}

export function TextSelectionToolbar({ onAddBookmark, onAddNote, containerRef }: Props) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<number | null>(null);

  const updatePosition = useCallback(() => {
    const selection = window.getSelection();
    const container = containerRef.current;

    if (!selection || selection.isCollapsed || !selection.rangeCount || !container) {
      setVisible(false);
      return;
    }

    // Проверяем что выделение внутри contentArea
    const anchorNode = selection.anchorNode;
    if (!anchorNode || !container.contains(anchorNode)) {
      setVisible(false);
      return;
    }

    const text = selection.toString().trim();
    if (!text || text.length === 0) {
      setVisible(false);
      return;
    }

    // Получаем позицию выделенного текста
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    // Позиционируем тултип над выделением, центрируем по горизонтали
    const top = rect.top + window.scrollY - 56; // 56px над выделением
    const left = rect.left + window.scrollX + rect.width / 2;

    setPosition({ top, left });
    setVisible(true);
  }, [containerRef]);

  useEffect(() => {
    let timeoutId: number | null = null;

    const handleSelectionChange = () => {
      // Debounce чтобы не мигать при drag
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      timeoutId = window.setTimeout(updatePosition, 150);
    };

    const handleMouseUp = () => {
      // Обновляем сразу после отпускания мыши
      window.setTimeout(updatePosition, 10);
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener("mouseup", handleMouseUp);
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [updatePosition]);

  // Скрываем при клике вне тултипа и снятии выделения
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (toolbarRef.current && toolbarRef.current.contains(e.target as Node)) {
        // Клик внутри тултипа — не скрываем
        return;
      }
      // Ждём 100мс и проверяем выделение
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = window.setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed) {
          setVisible(false);
        }
      }, 100);
    };

    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      if (hideTimeoutRef.current !== null) {
        window.clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className={cn(
        "fixed z-[60] flex items-center gap-1 rounded-lg border bg-popover text-popover-foreground shadow-lg p-1",
        "transform -translate-x-1/2 animate-in fade-in-0 zoom-in-95 duration-200"
      )}
      style={{
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
    >
      <Button
        size="sm"
        variant="ghost"
        className="h-8 gap-1.5 text-xs"
        onClick={() => {
          onAddBookmark();
          setVisible(false);
          window.getSelection()?.removeAllRanges();
        }}
      >
        <BookmarkPlus className="size-4" />
        Закладка
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 gap-1.5 text-xs"
        onClick={() => {
          onAddNote();
          setVisible(false);
          window.getSelection()?.removeAllRanges();
        }}
      >
        <StickyNote className="size-4" />
        Заметка
      </Button>
    </div>
  );
}
