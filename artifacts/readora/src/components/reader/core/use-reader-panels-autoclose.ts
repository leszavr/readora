// Adapted from voxlibris use-reader-panels-autoclose.ts (direct port)

import { useCallback, useEffect, useRef, type RefObject } from "react";

interface UseReaderPanelsAutocloseOptions {
  isOpen: boolean;
  onClose: () => void;
  contentRef: RefObject<HTMLElement | null>;
  protectedRefs?: Array<RefObject<HTMLElement | null>>;
  inactivityMs?: number;
}

export function useReaderPanelsAutoclose({
  isOpen,
  onClose,
  contentRef,
  protectedRefs = [],
  inactivityMs = 3000,
}: UseReaderPanelsAutocloseOptions): void {
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
  }, []);

  const resetInactivityTimer = useCallback(() => {
    clearInactivityTimer();

    if (!isOpen) {
      return;
    }

    inactivityTimerRef.current = setTimeout(() => {
      onClose();
    }, inactivityMs);
  }, [clearInactivityTimer, inactivityMs, isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      clearInactivityTimer();
      return;
    }

    const contentElement = contentRef.current;
    const protectedElements = protectedRefs
      .map((ref) => ref.current)
      .filter((element): element is HTMLElement => Boolean(element));

    const isInsideProtectedPanel = (target: EventTarget | null): boolean => {
      if (!(target instanceof Node)) {
        return false;
      }
      return protectedElements.some((element) => element.contains(target));
    };

    const handleReaderActivity = (event: Event) => {
      if (isInsideProtectedPanel(event.target)) {
        clearInactivityTimer();
        return;
      }
      resetInactivityTimer();
    };

    const handleTextInteraction = (event: Event) => {
      if (isInsideProtectedPanel(event.target)) {
        return;
      }
      onClose();
    };

    const handleProtectedPointerEnter = () => {
      clearInactivityTimer();
    };

    const handleProtectedPointerLeave = () => {
      resetInactivityTimer();
    };

    const handleProtectedFocusIn = () => {
      clearInactivityTimer();
    };

    const handleProtectedFocusOut = (event: FocusEvent) => {
      if (isInsideProtectedPanel(event.relatedTarget)) {
        return;
      }
      resetInactivityTimer();
    };

    resetInactivityTimer();

    document.addEventListener("pointerdown", handleReaderActivity, true);
    document.addEventListener("pointermove", handleReaderActivity, true);
    document.addEventListener("touchstart", handleReaderActivity, true);
    document.addEventListener("input", handleReaderActivity, true);
    document.addEventListener("keydown", handleReaderActivity, true);

    contentElement?.addEventListener("pointerdown", handleTextInteraction, true);
    contentElement?.addEventListener("touchstart", handleTextInteraction, true);
    contentElement?.addEventListener("wheel", handleTextInteraction, true);
    contentElement?.addEventListener("focusin", handleTextInteraction, true);

    protectedElements.forEach((element) => {
      element.addEventListener("pointerenter", handleProtectedPointerEnter, true);
      element.addEventListener("pointerleave", handleProtectedPointerLeave, true);
      element.addEventListener("focusin", handleProtectedFocusIn, true);
      element.addEventListener("focusout", handleProtectedFocusOut as EventListener, true);
    });

    return () => {
      clearInactivityTimer();
      document.removeEventListener("pointerdown", handleReaderActivity, true);
      document.removeEventListener("pointermove", handleReaderActivity, true);
      document.removeEventListener("touchstart", handleReaderActivity, true);
      document.removeEventListener("input", handleReaderActivity, true);
      document.removeEventListener("keydown", handleReaderActivity, true);
      contentElement?.removeEventListener("pointerdown", handleTextInteraction, true);
      contentElement?.removeEventListener("touchstart", handleTextInteraction, true);
      contentElement?.removeEventListener("wheel", handleTextInteraction, true);
      contentElement?.removeEventListener("focusin", handleTextInteraction, true);
      protectedElements.forEach((element) => {
        element.removeEventListener("pointerenter", handleProtectedPointerEnter, true);
        element.removeEventListener("pointerleave", handleProtectedPointerLeave, true);
        element.removeEventListener("focusin", handleProtectedFocusIn, true);
        element.removeEventListener("focusout", handleProtectedFocusOut as EventListener, true);
      });
    };
  }, [clearInactivityTimer, contentRef, isOpen, onClose, protectedRefs, resetInactivityTimer]);

  useEffect(() => {
    return () => {
      clearInactivityTimer();
    };
  }, [clearInactivityTimer]);
}
