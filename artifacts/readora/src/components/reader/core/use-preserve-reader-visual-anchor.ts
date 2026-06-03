// Direct port from voxlibris use-preserve-reader-visual-anchor.ts

import { useCallback, type RefObject } from "react";

interface PreserveReaderVisualAnchorOptions {
  scrollContainerRef: RefObject<HTMLElement | null>;
  contentAreaRef: RefObject<HTMLElement | null>;
}

interface CaretAnchor {
  type: "caret";
  node: Node;
  offset: number;
  top: number;
}

interface ElementAnchor {
  type: "element";
  element: HTMLElement;
  top: number;
}

type ReaderVisualAnchor = CaretAnchor | ElementAnchor;

const ANCHOR_INSET_X = 24;
const ANCHOR_INSET_Y = 24;

type CaretDocument = Document & {
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
};

function isNodeInside(container: HTMLElement, node: Node | null | undefined): boolean {
  if (!node) {
    return false;
  }
  if (node instanceof HTMLElement) {
    return container.contains(node);
  }
  return container.contains(node.parentElement);
}

function clampCoordinate(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getAnchorPoint(scrollContainer: HTMLElement, contentArea: HTMLElement): { x: number; y: number } | null {
  const scrollRect = scrollContainer.getBoundingClientRect();
  const contentRect = contentArea.getBoundingClientRect();

  if (scrollRect.width <= 2 || scrollRect.height <= 2) {
    return null;
  }

  const x = clampCoordinate(
    Math.max(contentRect.left, scrollRect.left) + ANCHOR_INSET_X,
    scrollRect.left + 1,
    scrollRect.right - 1,
  );
  const y = clampCoordinate(
    scrollRect.top + ANCHOR_INSET_Y,
    scrollRect.top + 1,
    scrollRect.bottom - 1,
  );

  return { x, y };
}

function getCaretRectTop(node: Node, offset: number): number | null {
  if (!node.isConnected) {
    return null;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const textNode = node as Text;
    const textLength = textNode.data.length;

    if (textLength === 0) {
      return textNode.parentElement?.getBoundingClientRect().top ?? null;
    }

    const safeOffset = Math.min(Math.max(offset, 0), textLength);
    const range = document.createRange();
    const startOffset = safeOffset === textLength ? Math.max(0, safeOffset - 1) : safeOffset;
    const endOffset = safeOffset === textLength ? safeOffset : Math.min(textLength, safeOffset + 1);

    range.setStart(textNode, startOffset);
    range.setEnd(textNode, endOffset);

    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    if (rect.height > 0) {
      return rect.top;
    }

    return textNode.parentElement?.getBoundingClientRect().top ?? null;
  }

  if (node instanceof HTMLElement) {
    return node.getBoundingClientRect().top;
  }

  return null;
}

function captureCaretAnchor(contentArea: HTMLElement, x: number, y: number): CaretAnchor | null {
  const caretDocument = document as CaretDocument;

  if (typeof caretDocument.caretPositionFromPoint === "function") {
    const caretPosition = caretDocument.caretPositionFromPoint(x, y);
    if (!caretPosition || !isNodeInside(contentArea, caretPosition.offsetNode)) {
      return null;
    }

    const top = getCaretRectTop(caretPosition.offsetNode, caretPosition.offset);
    if (top === null) {
      return null;
    }

    return { type: "caret", node: caretPosition.offsetNode, offset: caretPosition.offset, top };
  }

  if (typeof caretDocument.caretRangeFromPoint === "function") {
    const caretRange = caretDocument.caretRangeFromPoint(x, y);
    if (!caretRange || !isNodeInside(contentArea, caretRange.startContainer)) {
      return null;
    }

    const top = getCaretRectTop(caretRange.startContainer, caretRange.startOffset);
    if (top === null) {
      return null;
    }

    return { type: "caret", node: caretRange.startContainer, offset: caretRange.startOffset, top };
  }

  return null;
}

function findAnchorElement(target: HTMLElement, contentArea: HTMLElement): HTMLElement | null {
  const candidate = target.closest("p, li, blockquote, pre, h1, h2, h3, h4, h5, h6, img, hr, div");

  if (candidate instanceof HTMLElement && contentArea.contains(candidate)) {
    return candidate;
  }

  if (contentArea.contains(target)) {
    return target;
  }

  return null;
}

function captureElementAnchor(contentArea: HTMLElement, x: number, y: number): ElementAnchor | null {
  const target = document.elementFromPoint(x, y);
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const element = findAnchorElement(target, contentArea);
  if (!element) {
    return null;
  }

  return { type: "element", element, top: element.getBoundingClientRect().top };
}

function captureReaderVisualAnchor(scrollContainer: HTMLElement, contentArea: HTMLElement): ReaderVisualAnchor | null {
  const point = getAnchorPoint(scrollContainer, contentArea);
  if (!point) {
    return null;
  }

  return captureCaretAnchor(contentArea, point.x, point.y) ?? captureElementAnchor(contentArea, point.x, point.y);
}

function getCurrentAnchorTop(anchor: ReaderVisualAnchor): number | null {
  if (anchor.type === "caret") {
    return getCaretRectTop(anchor.node, anchor.offset);
  }

  if (!anchor.element.isConnected) {
    return null;
  }

  return anchor.element.getBoundingClientRect().top;
}

function restoreReaderVisualAnchor(scrollContainer: HTMLElement, anchor: ReaderVisualAnchor): void {
  const currentTop = getCurrentAnchorTop(anchor);
  if (currentTop === null) {
    return;
  }

  const delta = currentTop - anchor.top;
  if (Math.abs(delta) < 0.5) {
    return;
  }

  const nextScrollTop = scrollContainer.scrollTop + delta;
  const maxScrollTop = Math.max(scrollContainer.scrollHeight - scrollContainer.clientHeight, 0);
  scrollContainer.scrollTop = clampCoordinate(nextScrollTop, 0, maxScrollTop);
}

export function usePreserveReaderVisualAnchor({
  scrollContainerRef,
  contentAreaRef,
}: PreserveReaderVisualAnchorOptions): (updateLayout: () => void) => void {
  return useCallback(
    (updateLayout: () => void) => {
      const scrollContainer = scrollContainerRef.current;
      const contentArea = contentAreaRef.current;

      if (!scrollContainer || !contentArea) {
        updateLayout();
        return;
      }

      const anchor = captureReaderVisualAnchor(scrollContainer, contentArea);
      updateLayout();

      if (!anchor) {
        return;
      }

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          restoreReaderVisualAnchor(scrollContainer, anchor);
        });
      });
    },
    [contentAreaRef, scrollContainerRef]
  );
}
