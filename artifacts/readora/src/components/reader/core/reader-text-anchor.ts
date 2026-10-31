/**
 * Robust Text Anchoring System for Readora
 * 
 * Проблема: При изменении размера шрифта, межстрочного интервала или ширины контента
 * (reflow), пиксельная позиция скролла (scrollTop) перестаёт соответствовать тому же тексту.
 * 
 * Решение: Используем семантическое якорение на уровне параграфов + символьное смещение
 * внутри параграфа. Это даёт:
 * 1. Устойчивость к reflow — позиция привязана к структуре текста, не к пикселям
 * 2. Graceful degradation — если параграф изменился, fallback к началу параграфа или проценту
 * 3. Кросс-девайс синхронизацию — одинаковая позиция на ПК и смартфоне
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Семантическая позиция чтения — привязана к структуре текста, не к пикселям
 */
export interface SemanticReadingPosition {
  /** ID главы (из БД) */
  chapterId: number;
  
  /** 
   * Путь к элементу-контейнеру текста (параграф, заголовок и т.д.)
   * Формат: CSS-селектор или индекс пути в DOM
   * Примеры: "p:nth-of-type(5)", "h2#section-1", "div.chapter-content > p:eq(10)"
   */
  elementPath: string;
  
  /** 
   * Тип элемента для валидации (p, h1, h2, li, blockquote и т.д.)
   */
  elementTag: string;
  
  /**
   * Символьное смещение внутри текстового содержимого элемента
   * Отсчитывается от начала текстового контента элемента (без HTML-тегов)
   */
  charOffset: number;
  
  /**
   * Процент прогресса внутри главы (0-100) — для fallback и отображения
   */
  chapterPercent: number;
  
  /**
   * Хеш первых 100 символов элемента — для валидации, что элемент не изменился
   */
  contentHash: string;
  
  /**
   * Текстовый превью (первые ~50 символов) — для отладки и отображения пользователю
   */
  textPreview: string;

  /**
   * Глобальный символьный оффсет якоря от начала текста главы.
   * Подсказка (hint) для поиска по цитате при смене структуры DOM.
   */
  textOffset?: number;

  /**
   * Цитата якоря (TextQuoteSelector, подход W3C Web Annotation / Hypothesis):
   * точный текст, начиная с якорного символа. Поиск с нормализацией пробелов —
   * переживает смену разметки и reflow.
   */
  quoteExact?: string;

  /** Контекст до якоря (нормализованный, ~32 символа) */
  quotePrefix?: string;

  /** Контекст после якоря (нормализованный, ~32 символа) */
  quoteSuffix?: string;

  /** Версия формата для миграций */
  version: 2;

  /** Timestamp сохранения */
  timestamp: number;
}

/**
 * Legacy позиция (v1) — для обратной совместимости
 */
export interface LegacyReadingPosition {
  chapterId?: number;
  scrollTop: number;
  scrollHeight?: number;
  clientHeight?: number;
  timestamp?: number;
  textOffset?: number; // Глобальное смещение от начала контента
}

export type ReadingPosition = SemanticReadingPosition | LegacyReadingPosition;

export interface TextSelectionAnchor {
  version: 1;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  /** Контекст до выделения (нормализованный) — для устойчивого поиска при смене DOM */
  quotePrefix?: string;
  /** Контекст после выделения (нормализованный) */
  quoteSuffix?: string;
}

// =============================================================================
// Constants
// =============================================================================

const POSITION_VERSION = 2;
const CONTENT_HASH_LENGTH = 100;
const TEXT_PREVIEW_LENGTH = 50;
const MAX_ELEMENT_PATH_DEPTH = 5;
/** Длина цитаты якоря (символов, до нормализации пробелов) */
const QUOTE_EXACT_LENGTH = 64;
/** Длина контекста до/после якоря (символов) */
const QUOTE_CONTEXT_LENGTH = 32;
/** Минимальная длина цитаты для поиска (короткие фразы неоднозначны) */
const MIN_QUOTE_LENGTH = 8;

/**
 * Допуск в пикселях, при котором позиция считается концом главы.
 * Короткая глава (или последняя страница) может не скроллиться вообще —
 * без допуска такие главы никогда не дают 100% прочитанного.
 */
export const READER_END_SLACK_PX = 64;

export function isReaderScrollAtEnd(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number
): boolean {
  // scrollHeight = 0 означает, что контент ещё не отрисован.
  if (scrollHeight <= 0) return false;
  return scrollHeight - scrollTop - clientHeight <= READER_END_SLACK_PX;
}

// Селекторы для поиска текстовых элементов (в порядке приоритета)
const TEXT_ELEMENT_SELECTORS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'li', 'blockquote', 'pre', 'td', 'dt', 'dd'
];

// =============================================================================
// Content Hash Utilities
// =============================================================================

/**
 * Создаёт хеш содержимого для валидации элемента
 */
function createContentHash(text: string): string {
  const normalized = text
    .slice(0, CONTENT_HASH_LENGTH)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  
  // Простой хеш: первые 20 символов нормализованного текста + длина
  return `${normalized.slice(0, 20)}:${text.length}`;
}

/**
 * Проверяет, соответствует ли текущий элемент сохранённому хешу
 */
function validateContentHash(element: HTMLElement, expectedHash: string): boolean {
  const text = getElementTextContent(element);
  const actualHash = createContentHash(text);
  return actualHash === expectedHash;
}

// =============================================================================
// Element Path Utilities
// =============================================================================

/**
 * Создаёт путь к элементу относительно контейнера контента
 * Использует комбинацию: tag + nth-of-type + id (если есть)
 */
function createElementPath(element: HTMLElement, contentArea: HTMLElement): string {
  // Если у элемента есть ID — используем его (самый надёжный способ)
  if (element.id) {
    return `#${element.id}`;
  }
  
  const path: string[] = [];
  let current: HTMLElement | null = element;
  
  while (current && current !== contentArea && path.length < MAX_ELEMENT_PATH_DEPTH) {
    const tag = current.tagName.toLowerCase();
    
    // Считаем индекс среди элементов того же типа
    let index = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName.toLowerCase() === tag) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }
    
    // Добавляем :nth-of-type если есть несколько элементов этого типа
    const parent = current.parentElement;
    const hasSiblingsOfType = parent && parent.querySelectorAll(`:scope > ${tag}`).length > 1;
    
    path.unshift(hasSiblingsOfType ? `${tag}:nth-of-type(${index})` : tag);
    current = current.parentElement;
  }
  
  return path.join(' > ');
}

/**
 * Находит элемент по пути относительно контейнера
 */
function findElementByPath(path: string, contentArea: HTMLElement): HTMLElement | null {
  // Пробуем как CSS-селектор
  try {
    // Если путь начинается с # — ищем по ID
    if (path.startsWith('#')) {
      const id = path.slice(1);
      const element = contentArea.ownerDocument.getElementById(id);
      if (element && contentArea.contains(element)) {
        return element;
      }
    }
    
    // Ищем относительно contentArea
    const element = contentArea.querySelector(path) as HTMLElement | null;
    if (element) {
      return element;
    }
  } catch {
    // Невалидный селектор — продолжаем с fallback
  }
  
  return null;
}

// =============================================================================
// Text Content Utilities
// =============================================================================

/**
 * Получает текстовое содержимое элемента без учёта вложенных тегов
 * (только текстовые узлы на первом уровне + рекурсивно для inline-элементов)
 */
function getElementTextContent(element: HTMLElement): string {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  const texts: string[] = [];
  let node: Node | null;
  
  while ((node = walker.nextNode())) {
    texts.push(node.textContent || '');
  }
  
  return texts.join('');
}

/**
 * Находит текстовый узел и смещение внутри элемента по символьному offset
 */
function findTextNodeInElement(
  element: HTMLElement,
  charOffset: number
): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let remaining = Math.max(0, charOffset);
  let node: Node | null;
  
  while ((node = walker.nextNode())) {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      const length = textNode.data.length;
      
      if (remaining <= length) {
        return {
          node: textNode,
          offset: Math.min(remaining, length)
        };
      }
      
      remaining -= length;
    }
  }
  
  // Если offset больше длины текста — возвращаем конец последнего узла
  return null;
}

function getTextOffset(root: HTMLElement, node: Node, offset: number): number {
  const range = document.createRange();
  range.setStart(root, 0);
  range.setEnd(node, offset);
  return range.toString().length;
}

function findTextPosition(root: HTMLElement, textOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, textOffset);
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    if (remaining <= textNode.data.length) {
      return { node: textNode, offset: remaining };
    }
    remaining -= textNode.data.length;
  }

  return null;
}

export function findTextRangeByText(root: HTMLElement, text: string): Range | null {
  const target = text.trim();
  if (!target) return null;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let fullText = "";
  let node: Node | null;
  while ((node = walker.nextNode())) {
    fullText += node.textContent ?? "";
  }

  const startOffset = fullText.indexOf(target);
  if (startOffset < 0) return null;
  return restoreTextSelectionAnchor(
    { version: 1, startOffset, endOffset: startOffset + target.length, selectedText: target },
    root,
  );
}

// =============================================================================
// Quote matching (TextQuoteSelector: exact + prefix + suffix + hint)
// =============================================================================

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

interface ChapterTextIndex {
  /** Полный текст главы с нормализованными пробелами (для поиска) */
  normText: string;
  /** normText[i] → сырой оффсет в конкатенации текстовых узлов */
  rawIndexOf: number[];
  nodes: Text[];
  nodeStarts: number[];
}

/**
 * Строит индекс текста главы: конкатенация текстовых узлов + нормализация
 * пробелов с картой соответствия нормализованных позиций сырым оффсетам.
 * Нормализация позволяет матчить цитаты при любых переносах строк и границах
 * элементов (практика W3C Web Annotation / Chromium Text Fragments).
 */
function buildChapterTextIndex(contentArea: HTMLElement): ChapterTextIndex | null {
  const walker = document.createTreeWalker(contentArea, NodeFilter.SHOW_TEXT, null);
  const nodes: Text[] = [];
  const nodeStarts: number[] = [];
  const parts: string[] = [];
  let rawPos = 0;
  let n: Node | null;
  while ((n = walker.nextNode())) {
    const textNode = n as Text;
    const s = textNode.textContent || "";
    nodes.push(textNode);
    nodeStarts.push(rawPos);
    parts.push(s);
    rawPos += s.length;
  }
  if (nodes.length === 0) return null;

  const rawText = parts.join("");
  let normText = "";
  const rawIndexOf: number[] = [];
  let prevWasSpace = true; // съедает ведущие пробелы
  const wsRe = /\s/;
  for (let i = 0; i < rawText.length; i++) {
    const ch = rawText[i];
    if (wsRe.test(ch)) {
      if (!prevWasSpace) {
        normText += " ";
        rawIndexOf.push(i);
        prevWasSpace = true;
      }
    } else {
      normText += ch;
      rawIndexOf.push(i);
      prevWasSpace = false;
    }
  }
  if (normText.endsWith(" ")) {
    normText = normText.slice(0, -1);
    rawIndexOf.pop();
  }
  if (!normText) return null;

  return { normText, rawIndexOf, nodes, nodeStarts };
}

function findTextPositionByIndex(
  index: ChapterTextIndex,
  rawOffset: number,
): { node: Text; offset: number } | null {
  let lo = 0;
  let hi = index.nodes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const start = index.nodeStarts[mid];
    const end = start + (index.nodes[mid].textContent || "").length;
    if (rawOffset < start) {
      hi = mid - 1;
    } else if (rawOffset >= end) {
      lo = mid + 1;
    } else {
      return { node: index.nodes[mid], offset: rawOffset - start };
    }
  }
  const last = index.nodes.length - 1;
  if (last >= 0) {
    const node = index.nodes[last];
    return { node, offset: (node.textContent || "").length };
  }
  return null;
}

interface QuoteContext {
  exact: string;
  prefix?: string;
  suffix?: string;
  /** Ожидаемая сырая позиция совпадения (тай-брейкер при повторах) */
  hint?: number;
}

/**
 * Ищет цитату в тексте главы. Возвращает Range, накрывающий совпадение,
 * либо null. Кандидаты ранжируются по скорингу в духе Hypothesis:
 * цитата (50) + префикс (20) + суффикс (20) + близость к hint (2).
 */
function matchQuoteInContentArea(contentArea: HTMLElement, quote: QuoteContext): Range | null {
  const normExact = collapseWhitespace(quote.exact);
  if (normExact.length < MIN_QUOTE_LENGTH) return null;

  const index = buildChapterTextIndex(contentArea);
  if (!index) return null;

  const candidates: number[] = [];
  let pos = index.normText.indexOf(normExact);
  while (pos !== -1) {
    candidates.push(pos);
    pos = index.normText.indexOf(normExact, pos + 1);
  }
  if (candidates.length === 0) return null;

  const normPrefix = quote.prefix ? collapseWhitespace(quote.prefix) : "";
  const normSuffix = quote.suffix ? collapseWhitespace(quote.suffix) : "";
  const rawLength = index.rawIndexOf.length;

  let bestPos = candidates[0];
  let bestScore = -1;
  for (const candidate of candidates) {
    const prefixOk =
      normPrefix.length >= MIN_QUOTE_LENGTH &&
      candidate >= normPrefix.length &&
      index.normText.startsWith(normPrefix, candidate - normPrefix.length)
        ? 1
        : 0;
    const suffixOk =
      normSuffix.length >= MIN_QUOTE_LENGTH &&
      index.normText.startsWith(normSuffix, candidate + normExact.length)
        ? 1
        : 0;
    let posScore = 0;
    if (typeof quote.hint === "number" && rawLength > 0) {
      const rawStart = index.rawIndexOf[candidate] ?? 0;
      posScore = Math.max(0, 1 - Math.abs(rawStart - quote.hint) / rawLength);
    }
    const score = 50 + 20 * prefixOk + 20 * suffixOk + 2 * posScore;
    if (score > bestScore) {
      bestScore = score;
      bestPos = candidate;
    }
  }

  const rawStart = index.rawIndexOf[bestPos] ?? 0;
  const rawEndRaw = index.rawIndexOf[Math.min(bestPos + normExact.length - 1, rawLength - 1)] ?? rawStart;
  const startPoint = findTextPositionByIndex(index, rawStart);
  const endPoint = findTextPositionByIndex(index, rawEndRaw + 1);
  if (!startPoint || !endPoint) return null;

  const range = document.createRange();
  range.setStart(startPoint.node, startPoint.offset);
  range.setEnd(endPoint.node, endPoint.offset);
  return range;
}

function getChapterRawText(contentArea: HTMLElement): string {
  const walker = document.createTreeWalker(contentArea, NodeFilter.SHOW_TEXT, null);
  const parts: string[] = [];
  let n: Node | null;
  while ((n = walker.nextNode())) {
    parts.push(n.textContent || "");
  }
  return parts.join("");
}

export function captureTextSelectionAnchor(
  selection: Selection | null,
  contentArea: HTMLElement,
): TextSelectionAnchor | null {
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;

  const range = selection.getRangeAt(0);
  if (!contentArea.contains(range.startContainer) || !contentArea.contains(range.endContainer)) return null;

  const startOffset = getTextOffset(contentArea, range.startContainer, range.startOffset);
  const endOffset = getTextOffset(contentArea, range.endContainer, range.endOffset);
  const selectedText = range.toString().trim().slice(0, 100);

  if (!selectedText || endOffset <= startOffset) return null;

  // Контекст вокруг выделения — для поиска при несовпадении оффсетов
  const rawText = getChapterRawText(contentArea);
  const rawPrefix = rawText.slice(Math.max(0, startOffset - QUOTE_CONTEXT_LENGTH), startOffset);
  const rawSuffix = rawText.slice(endOffset, endOffset + QUOTE_CONTEXT_LENGTH);

  return {
    version: 1,
    startOffset,
    endOffset,
    selectedText,
    quotePrefix: collapseWhitespace(rawPrefix) || undefined,
    quoteSuffix: collapseWhitespace(rawSuffix) || undefined,
  };
}

export function restoreTextSelectionAnchor(
  anchor: TextSelectionAnchor,
  contentArea: HTMLElement,
): Range | null {
  if (anchor.version !== 1 || anchor.endOffset <= anchor.startOffset) return null;

  const start = findTextPosition(contentArea, anchor.startOffset);
  const end = findTextPosition(contentArea, anchor.endOffset);
  if (start && end) {
    const range = document.createRange();
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);

    // Верификация: оффсеты могли сместиться при изменении DOM/текста
    const rangeText = collapseWhitespace(range.toString());
    const expected = collapseWhitespace(anchor.selectedText);
    if (!expected || rangeText.includes(expected)) {
      return range;
    }
  }

  // Fallback: поиск выделения по тексту с контекстом
  if (anchor.selectedText) {
    return matchQuoteInContentArea(contentArea, {
      exact: anchor.selectedText,
      prefix: anchor.quotePrefix,
      suffix: anchor.quoteSuffix,
      hint: anchor.startOffset,
    });
  }

  return null;
}

export function showTextSelectionHighlight(
  range: Range,
  scrollContainer?: HTMLElement | null,
): () => void {
  let layers: HTMLElement[] = [];

  const createLayers = (count: number) => Array.from({ length: count }, () => {
    const layer = document.createElement("div");
    layer.className = "readora-note-highlight-overlay";
    document.body.appendChild(layer);
    return layer;
  });

  const updatePositions = () => {
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0);
    if (rects.length !== layers.length) {
      layers.forEach((layer) => layer.remove());
      layers = createLayers(rects.length);
    }
    rects.forEach((rect, index) => {
      const layer = layers[index];
      layer.style.left = `${rect.left}px`;
      layer.style.top = `${rect.top}px`;
      layer.style.width = `${rect.width}px`;
      layer.style.height = `${rect.height}px`;
    });
  };

  updatePositions();
  if (layers.length === 0) return () => undefined;

  let animationFrame = 0;
  const schedulePositionUpdate = () => {
    window.cancelAnimationFrame(animationFrame);
    animationFrame = window.requestAnimationFrame(updatePositions);
  };
  scrollContainer?.addEventListener("scroll", schedulePositionUpdate, { passive: true });
  window.addEventListener("resize", schedulePositionUpdate, { passive: true });

  const showTimer = window.setTimeout(() => layers.forEach((layer) => layer.classList.add("is-visible")), 0);
  const timers = [
    window.setTimeout(() => layers.forEach((layer) => layer.classList.remove("is-visible")), 2_000),
  ];

  function cleanup() {
    window.clearTimeout(showTimer);
    timers.forEach((timer) => window.clearTimeout(timer));
    window.cancelAnimationFrame(animationFrame);
    scrollContainer?.removeEventListener("scroll", schedulePositionUpdate);
    window.removeEventListener("resize", schedulePositionUpdate);
    layers.forEach((layer) => layer.remove());
  }

  return cleanup;
}

// =============================================================================
// Position Capture (Save)
// =============================================================================

export interface CapturePositionOptions {
  chapterId: number;
  scrollContainer: HTMLElement;
  contentArea: HTMLElement;
  /** Дополнительный отступ от верха viewport (по умолчанию 8px) */
  viewportInset?: number;
}

/**
 * Захватывает текущую позицию чтения с семантическим якорением
 * 
 * Алгоритм:
 * 1. Находит элемент в левом верхнем углу viewport (с небольшим inset)
 * 2. Создаёт путь к этому элементу
 * 3. Вычисляет символьное смещение внутри элемента
 * 4. Создаёт хеш содержимого для валидации
 */
export function captureSemanticPosition(options: CapturePositionOptions): SemanticReadingPosition | null {
  const { chapterId, scrollContainer, contentArea, viewportInset = 8 } = options;
  
  // Получаем координаты левого верхнего угла контента в viewport
  const containerRect = scrollContainer.getBoundingClientRect();
  const contentRect = contentArea.getBoundingClientRect();
  
  const x = Math.max(contentRect.left + viewportInset, containerRect.left + viewportInset);
  const y = containerRect.top + viewportInset;
  
  // Находим элемент в этой точке
  const element = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!element || !contentArea.contains(element)) {
    return null;
  }
  
  // Находим ближайший текстовый родительский элемент
  const textElement = element.closest(TEXT_ELEMENT_SELECTORS.join(', ')) as HTMLElement | null;
  if (!textElement || !contentArea.contains(textElement)) {
    return null;
  }
  
  // Получаем caret position внутри элемента
  const caretDocument = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  
  let caretNode: Node | null = null;
  let caretOffset = 0;
  
  if (typeof caretDocument.caretPositionFromPoint === 'function') {
    const pos = caretDocument.caretPositionFromPoint(x, y);
    if (pos && textElement.contains(pos.offsetNode)) {
      caretNode = pos.offsetNode;
      caretOffset = pos.offset;
    }
  } else if (typeof caretDocument.caretRangeFromPoint === 'function') {
    const range = caretDocument.caretRangeFromPoint(x, y);
    if (range && textElement.contains(range.startContainer)) {
      caretNode = range.startContainer;
      caretOffset = range.startOffset;
    }
  }
  
  if (!caretNode) {
    // Fallback: используем начало элемента
    caretNode = textElement;
    caretOffset = 0;
  }
  
  // Вычисляем символьное смещение от начала элемента
  let charOffset = 0;
  if (caretNode.nodeType === Node.TEXT_NODE && caretNode.parentElement === textElement) {
    // Прямой текстовый узел внутри элемента
    const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node === caretNode) {
        charOffset += caretOffset;
        break;
      }
      charOffset += (node.textContent || '').length;
    }
  } else if (caretNode === textElement) {
    // Узел — сам элемент, offset относится к дочерним узлам
    const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    let nodeIndex = 0;
    while ((node = walker.nextNode())) {
      if (nodeIndex >= caretOffset) {
        break;
      }
      charOffset += (node.textContent || '').length;
      nodeIndex++;
    }
  } else {
    // caretNode внутри вложенного элемента
    const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT, null);
    let node: Node | null;
    let found = false;
    while ((node = walker.nextNode())) {
      if (node === caretNode || node.contains(caretNode)) {
        charOffset += caretOffset;
        found = true;
        break;
      }
      charOffset += (node.textContent || '').length;
    }
    if (!found) {
      charOffset = 0;
    }
  }
  
  // Получаем текст для хеша и превью
  const elementText = getElementTextContent(textElement);
  const contentHash = createContentHash(elementText);
  const textPreview = elementText.slice(0, TEXT_PREVIEW_LENGTH).replace(/\s+/g, ' ').trim();
  
  // Цитата якоря с контекстом (TextQuoteSelector): глобальный оффсет якоря
  // в тексте главы + exact/prefix/suffix. Переживает смену DOM-структуры
  // и правки текста выше по документу.
  const chapterRawText = getChapterRawText(contentArea);
  let textBeforeElement = 0;
  {
    const walker = document.createTreeWalker(contentArea, NodeFilter.SHOW_TEXT, null);
    const parts: string[] = [];
    let node: Node | null;
    let seenElement = false;
    while ((node = walker.nextNode())) {
      if (!seenElement && textElement.contains(node)) {
        seenElement = true;
        textBeforeElement = parts.reduce((acc, p) => acc + p.length, 0);
      }
      parts.push(node.textContent || "");
    }
  }
  const anchorGlobalOffset = textBeforeElement + Math.max(0, charOffset);
  const rawExact = chapterRawText.slice(anchorGlobalOffset, anchorGlobalOffset + QUOTE_EXACT_LENGTH);
  const rawPrefix = chapterRawText.slice(Math.max(0, anchorGlobalOffset - QUOTE_CONTEXT_LENGTH), anchorGlobalOffset);
  const rawSuffix = chapterRawText.slice(
    anchorGlobalOffset + rawExact.length,
    anchorGlobalOffset + rawExact.length + QUOTE_CONTEXT_LENGTH,
  );
  const quoteExact = collapseWhitespace(rawExact);

  // Вычисляем процент прогресса в главе
  const atChapterEnd = isReaderScrollAtEnd(
    scrollContainer.scrollTop,
    scrollContainer.scrollHeight,
    scrollContainer.clientHeight
  );
  const scrollProgress = scrollContainer.scrollTop / 
    Math.max(1, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  const chapterPercent = atChapterEnd
    ? 100
    : Math.round(Math.max(0, Math.min(100, scrollProgress * 100)));
  
  return {
    chapterId,
    elementPath: createElementPath(textElement, contentArea),
    elementTag: textElement.tagName.toLowerCase(),
    charOffset: Math.max(0, charOffset),
    chapterPercent,
    contentHash,
    textPreview,
    textOffset: anchorGlobalOffset,
    quoteExact: quoteExact.length >= MIN_QUOTE_LENGTH ? quoteExact : undefined,
    quotePrefix: collapseWhitespace(rawPrefix) || undefined,
    quoteSuffix: collapseWhitespace(rawSuffix) || undefined,
    version: POSITION_VERSION,
    timestamp: Date.now(),
  };
}

// =============================================================================
// Position Restore
// =============================================================================

export interface RestorePositionOptions {
  position: SemanticReadingPosition;
  scrollContainer: HTMLElement;
  contentArea: HTMLElement;
  /** Дополнительный отступ от верха viewport (по умолчанию 8px) */
  viewportInset?: number;
  /** Плавная прокрутка (по умолчанию false) */
  smooth?: boolean;
}

export interface RestoreResult {
  success: boolean;
  method: 'exact' | 'quote' | 'element-start' | 'percent' | 'failed';
  actualElement?: HTMLElement;
}

/**
 * Восстанавливает позицию чтения с семантическим якорением
 * 
 * Алгоритм:
 * 1. Находит элемент по сохранённому пути
 * 2. Проверяет хеш содержимого (валидация)
 * 3. Если хеш не совпадает — ищет по цитате с контекстом (TextQuoteSelector),
 *    затем по текстовому превью
 * 4. Прокручивает к нужному символьному offset внутри элемента
 * 5. Fallback к началу элемента → проценту → началу главы
 */
export function restoreSemanticPosition(options: RestorePositionOptions): RestoreResult {
  const { position, scrollContainer, contentArea, viewportInset = 8, smooth = false } = options;

  const scrollRangeIntoView = (range: Range): void => {
    const rect = range.getBoundingClientRect();
    const containerRect = scrollContainer.getBoundingClientRect();
    const desiredTop = containerRect.top + viewportInset;
    const delta = rect.top - desiredTop;
    const targetScrollTop = scrollContainer.scrollTop + delta;
    const maxScroll = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));

    scrollContainer.scrollTo({
      top: clampedScrollTop,
      behavior: smooth ? 'smooth' : 'auto'
    });
  };

  // Шаг 1: Находим элемент по пути
  let element = findElementByPath(position.elementPath, contentArea);
  let method: RestoreResult['method'] = 'exact';
  let elementValid = element !== null && validateContentHash(element, position.contentHash);

  // Шаг 2: Валидация по хешу
  if (element && !elementValid) {
    // Хеш не совпадает — элемент изменился
    console.warn('[TextAnchor] Content hash mismatch, trying quote fallback');

    // Шаг 2a: поиск по цитате с контекстом — точнее превью, находит якорный символ
    if (position.quoteExact) {
      const quoteRange = matchQuoteInContentArea(contentArea, {
        exact: position.quoteExact,
        prefix: position.quotePrefix,
        suffix: position.quoteSuffix,
        hint: position.textOffset,
      });
      if (quoteRange) {
        const anchorPoint = document.createRange();
        anchorPoint.setStart(quoteRange.startContainer, quoteRange.startOffset);
        anchorPoint.setEnd(quoteRange.startContainer, quoteRange.startOffset);
        scrollRangeIntoView(anchorPoint);
        return { success: true, method: 'quote' };
      }
    }

    // Шаг 2b: пробуем найти по текстовому превью
    const previewText = position.textPreview.toLowerCase();
    const candidates = Array.from(contentArea.querySelectorAll(position.elementTag)) as HTMLElement[];

    let bestMatch: HTMLElement | null = null;
    let bestScore = 0;

    for (const candidate of candidates) {
      const text = getElementTextContent(candidate).toLowerCase();
      if (text.includes(previewText.slice(0, 20))) {
        // Простое совпадение подстроки
        const score = previewText.split(' ').filter(word => text.includes(word)).length;
        if (score > bestScore) {
          bestScore = score;
          bestMatch = candidate;
        }
      }
    }

    if (bestMatch) {
      element = bestMatch;
      method = 'element-start';
      elementValid = true;
      console.log('[TextAnchor] Found element by text preview');
    } else {
      element = null;
    }
  }

  // Шаг 2c: путь не разрезолвился — тоже пробуем цитату до процента
  if (!elementValid && element === null && position.quoteExact) {
    const quoteRange = matchQuoteInContentArea(contentArea, {
      exact: position.quoteExact,
      prefix: position.quotePrefix,
      suffix: position.quoteSuffix,
      hint: position.textOffset,
    });
    if (quoteRange) {
      const anchorPoint = document.createRange();
      anchorPoint.setStart(quoteRange.startContainer, quoteRange.startOffset);
      anchorPoint.setEnd(quoteRange.startContainer, quoteRange.startOffset);
      scrollRangeIntoView(anchorPoint);
      return { success: true, method: 'quote' };
    }
  }

  // Шаг 3: Восстановление позиции
  if (element) {
    // Находим текстовый узел и offset
    const target = findTextNodeInElement(element, position.charOffset);

    if (target) {
      // Создаём range для получения координат
      const range = document.createRange();
      range.setStart(target.node, target.offset);
      range.setEnd(target.node, target.offset);

      scrollRangeIntoView(range);

      return {
        success: true,
        method,
        actualElement: element
      };
    } else {
      // Не удалось найти точный offset — fallback к началу элемента
      method = 'element-start';
      const elementRect = element.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const delta = elementRect.top - containerRect.top - viewportInset;

      scrollContainer.scrollTop += delta;

      return {
        success: true,
        method,
        actualElement: element
      };
    }
  }

  // Шаг 4: Fallback к проценту прогресса
  method = 'percent';
  const maxScroll = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  const targetScrollTop = (position.chapterPercent / 100) * maxScroll;

  scrollContainer.scrollTo({
    top: targetScrollTop,
    behavior: smooth ? 'smooth' : 'auto'
  });

  return {
    success: true,
    method: 'percent'
  };
}

// =============================================================================
// Serialization
// =============================================================================

/**
 * Сериализует семантическую позицию в строку для хранения
 */
export function serializeSemanticPosition(position: SemanticReadingPosition): string {
  return JSON.stringify(position);
}

/**
 * Парсит строку позиции, поддерживает миграцию из legacy формата
 */
export function parseReadingPosition(raw: string | null | undefined): SemanticReadingPosition | null {
  if (!raw) return null;
  
  try {
    const parsed = JSON.parse(raw) as Partial<SemanticReadingPosition & LegacyReadingPosition>;
    
    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }
    
    // Проверяем версию
    if (parsed.version === POSITION_VERSION) {
      // Современный формат
      if (
        typeof parsed.chapterId === 'number' &&
        typeof parsed.elementPath === 'string' &&
        typeof parsed.elementTag === 'string' &&
        typeof parsed.charOffset === 'number'
      ) {
        return {
          chapterId: parsed.chapterId,
          elementPath: parsed.elementPath,
          elementTag: parsed.elementTag,
          charOffset: parsed.charOffset,
          chapterPercent: typeof parsed.chapterPercent === 'number' ? parsed.chapterPercent : 0,
          contentHash: parsed.contentHash || '',
          textPreview: parsed.textPreview || '',
          textOffset: typeof parsed.textOffset === 'number' ? parsed.textOffset : undefined,
          quoteExact: typeof parsed.quoteExact === 'string' && parsed.quoteExact ? parsed.quoteExact : undefined,
          quotePrefix: typeof parsed.quotePrefix === 'string' ? parsed.quotePrefix : undefined,
          quoteSuffix: typeof parsed.quoteSuffix === 'string' ? parsed.quoteSuffix : undefined,
          version: POSITION_VERSION,
          timestamp: parsed.timestamp || Date.now(),
        };
      }
    }
    
    // Legacy формат (v1) — миграция невозможна без контекста, возвращаем null
    // Вызвающий код должен использовать legacy fallback
    return null;
  } catch {
    return null;
  }
}

/**
 * Проверяет, можно ли восстановить позицию для данной главы
 */
export function canRestorePositionForChapter(
  position: SemanticReadingPosition | LegacyReadingPosition | null,
  currentChapterId: number
): boolean {
  if (!position) return false;
  return position.chapterId === currentChapterId;
}

// =============================================================================
// Legacy Compatibility
// =============================================================================

/**
 * Конвертирует legacy позицию в приблизительную семантическую
 * Используется для миграции старых данных
 */
export function migrateLegacyPosition(
  legacy: LegacyReadingPosition,
  chapterId: number,
  scrollContainer: HTMLElement,
  contentArea: HTMLElement
): SemanticReadingPosition | null {
  // Пытаемся захватить текущую позицию как семантическую
  const semantic = captureSemanticPosition({
    chapterId,
    scrollContainer,
    contentArea,
  });
  
  if (semantic) {
    // Переопределяем процент из legacy позиции
    if (typeof legacy.scrollTop === 'number' && 
        typeof legacy.scrollHeight === 'number' && 
        typeof legacy.clientHeight === 'number') {
      const scrollable = Math.max(1, legacy.scrollHeight - legacy.clientHeight);
      const percent = Math.round((legacy.scrollTop / scrollable) * 100);
      semantic.chapterPercent = Math.max(0, Math.min(100, percent));
    }
    return semantic;
  }
  
  return null;
}