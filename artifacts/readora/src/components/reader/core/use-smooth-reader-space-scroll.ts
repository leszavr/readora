// Direct port from voxlibris use-smooth-reader-space-scroll.ts

import { useEffect, useRef, type RefObject } from "react";

interface UseSmoothReaderSpaceScrollOptions {
  scrollContainerRef: RefObject<HTMLElement | null>;
  enabled?: boolean;
}

function isInteractiveElement(target: HTMLElement | null): boolean {
  if (!target) {
    return false;
  }
  return !!target.closest(
    "input, textarea, select, button, a, [role='button'], [contenteditable='true']"
  );
}

export function useSmoothReaderSpaceScroll({
  scrollContainerRef,
  enabled = true,
}: UseSmoothReaderSpaceScrollOptions) {
  const lastScrollAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " && event.code !== "Space") {
        return;
      }

      const target = event.target instanceof HTMLElement ? event.target : null;
      if (isInteractiveElement(target)) {
        return;
      }

      if (event.ctrlKey || event.altKey || event.metaKey) {
        return;
      }

      const container = scrollContainerRef.current;
      if (!container) {
        return;
      }

      const now = Date.now();
      if (now - lastScrollAtRef.current < 180) {
        event.preventDefault();
        return;
      }

      lastScrollAtRef.current = now;
      event.preventDefault();
      event.stopPropagation();

      const scrollDistance = Math.max(160, Math.round(container.clientHeight * 0.95));
      const direction = event.shiftKey ? -1 : 1;

      container.scrollBy({
        top: scrollDistance * direction,
        behavior: "smooth",
      });
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [enabled, scrollContainerRef]);
}
