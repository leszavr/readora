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

// =============================================================================
// Constants
// =============================================================================

const POSITION_VERSION = 2;
const CONTENT_HASH_LENGTH = 100;
const TEXT_PREVIEW_LENGTH = 50;
const MAX_ELEMENT_PATH_DEPTH = 5;

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
  
  // Вычисляем процент прогресса в главе
  const scrollProgress = scrollContainer.scrollTop / 
    Math.max(1, scrollContainer.scrollHeight - scrollContainer.clientHeight);
  const chapterPercent = Math.round(Math.max(0, Math.min(100, scrollProgress * 100)));
  
  return {
    chapterId,
    elementPath: createElementPath(textElement, contentArea),
    elementTag: textElement.tagName.toLowerCase(),
    charOffset: Math.max(0, charOffset),
    chapterPercent,
    contentHash,
    textPreview,
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
  method: 'exact' | 'element-start' | 'percent' | 'failed';
  actualElement?: HTMLElement;
}

/**
 * Восстанавливает позицию чтения с семантическим якорением
 * 
 * Алгоритм:
 * 1. Находит элемент по сохранённому пути
 * 2. Проверяет хеш содержимого (валидация)
 * 3. Если хеш не совпадает — ищем по текстовому превью
 * 4. Прокручивает к нужному символьному offset внутри элемента
 * 5. Fallback к началу элемента → проценту → началу главы
 */
export function restoreSemanticPosition(options: RestorePositionOptions): RestoreResult {
  const { position, scrollContainer, contentArea, viewportInset = 8, smooth = false } = options;
  
  // Шаг 1: Находим элемент по пути
  let element = findElementByPath(position.elementPath, contentArea);
  let method: RestoreResult['method'] = 'exact';
  
  // Шаг 2: Валидация по хешу
  if (element && !validateContentHash(element, position.contentHash)) {
    // Хеш не совпадает — элемент изменился
    console.warn('[TextAnchor] Content hash mismatch, trying text preview fallback');
    
    // Пробуем найти по текстовому превью
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
      console.log('[TextAnchor] Found element by text preview');
    } else {
      element = null;
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
      
      const rect = range.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      
      // Вычисляем нужную позицию скролла
      const desiredTop = containerRect.top + viewportInset;
      const delta = rect.top - desiredTop;
      const targetScrollTop = scrollContainer.scrollTop + delta;
      
      // Прокручиваем
      const maxScroll = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const clampedScrollTop = Math.max(0, Math.min(targetScrollTop, maxScroll));
      
      scrollContainer.scrollTo({
        top: clampedScrollTop,
        behavior: smooth ? 'smooth' : 'auto'
      });
      
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