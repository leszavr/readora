# Semantic Text Anchoring System (v2)

## Обзор

Система семантического текстового якорения для Readora обеспечивает **устойчивое к reflow** позиционирование при чтении книг. В отличие от legacy системы (v1), которая использовала пиксельные координаты (`scrollTop`), новая система привязывает позицию к **структуре текста**.

## Проблема v1 (Legacy)

```typescript
// Legacy позиция — пиксельная
{
  chapterId: 123,
  scrollTop: 1500,        // ← Ломается при изменении размера шрифта!
  scrollHeight: 5000,     // ← Меняется при reflow
  clientHeight: 800,      // ← Зависит от устройства
  textOffset: 4500        // ← Глобальное смещение, хрупкое
}
```

**Почему это ломается:**
1. Пользователь читает на ПК с шрифтом 18px → `scrollTop: 1500`
2. Открывает на смартфоне с шрифтом 16px → тот же текст на `scrollTop: 1200`
3. Позиция "уезжает" — пользователь видит не тот абзац

## Решение v2 (Semantic)

```typescript
// Semantic позиция — привязана к тексту
{
  version: 2,
  chapterId: 123,
  elementPath: "p:nth-of-type(5)",  // ← Путь к параграфу
  elementTag: "p",                   // ← Тип элемента
  charOffset: 42,                    // ← Смещение внутри параграфа
  chapterPercent: 35,                // ← Fallback процент
  contentHash: "the quick brown:156", // ← Валидация содержимого
  textPreview: "The quick brown fox jumps over...", // ← Для поиска
  timestamp: 1704067200000
}
```

**Почему это работает:**
- `elementPath` указывает на конкретный параграф независимо от размера
- `charOffset` — позиция внутри параграфа, не зависит от шрифта
- При reflow текст переносится, но параграф остаётся тем же

## Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│                    ReaderPage.tsx                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  useDebouncedReaderProgressSave                     │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │  captureSemanticPosition()                  │   │   │
│  │  │  ├── Находит элемент в левом верхнем углу   │   │   │
│  │  │  ├── Создаёт elementPath (CSS селектор)     │   │   │
│  │  │  ├── Вычисляет charOffset                   │   │   │
│  │  │  └── Создаёт contentHash для валидации      │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  createSemanticProgressPayload()                    │   │
│  │  └── Сериализует в JSON → currentPosition           │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  Сохранение: localStorage + API (reading_progress)  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    При открытии книги                       │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  parseReaderPosition()                              │   │
│  │  ├── Пробует v2 (semantic)                          │   │
│  │  └── Fallback к v1 (legacy)                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
│                          ▼                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  restoreSemanticPosition()                          │   │
│  │  ├── Находит элемент по elementPath                 │   │
│  │  ├── Валидирует contentHash                         │   │
│  │  ├── Если хеш не совпадает → ищет по textPreview    │   │
│  │  ├── Прокручивает к charOffset                      │   │
│  │  └── Fallback к chapterPercent                      │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

## Edge Cases & Обработка

### 1. Элемент не найден (удалён или изменилась структура)

**Сценарий:** Пользователь читал параграф, который был удалён при обновлении книги.

**Обработка:**
```typescript
// Шаг 1: Пробуем найти по elementPath
const element = findElementByPath(position.elementPath, contentArea);
if (!element) {
  // Шаг 2: Fallback к chapterPercent
  scrollToPercent(position.chapterPercent);
}
```

**Результат:** Пользователь попадает примерно в ту же область главы.

### 2. Содержимое элемента изменилось (редакция текста)

**Сценарий:** Автор отредактировал параграф, `contentHash` не совпадает.

**Обработка:**
```typescript
if (!validateContentHash(element, position.contentHash)) {
  // Ищем по textPreview (fuzzy matching)
  const candidates = contentArea.querySelectorAll(position.elementTag);
  const bestMatch = findByTextPreview(candidates, position.textPreview);
  if (bestMatch) {
    // Нашли похожий элемент
    scrollToElement(bestMatch);
  }
}
```

**Результат:** Находим элемент с похожим текстом или fallback к проценту.

### 3. Шрифты ещё не загрузились (font loading race condition)

**Сценарий:** Восстановление позиции происходит до загрузки кастомных шрифтов.

**Обработка:**
```typescript
// Ждём полной отрисовки
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    restoreSemanticPosition(...);
  });
});

// + retry механизм
if (!success && attemptsLeft > 0) {
  setTimeout(restorePosition, retryDelayMs);
}
```

**Результат:** Позиция восстанавливается после стабилизации layout.

### 4. Пользователь начал скроллить до восстановления

**Сценарий:** Позиция восстанавливается с задержкой, пользователь уже скроллит.

**Обработка:**
```typescript
const markUserInteraction = () => {
  userInteracted = true;
  cancelRestore(); // Отменяем восстановление
};

container.addEventListener('wheel', markUserInteraction);
container.addEventListener('touchstart', markUserInteraction);
```

**Результат:** Уважаем намерение пользователя, не прокручиваем принудительно.

### 5. Legacy позиции (миграция)

**Сценарий:** У пользователя сохранены позиции в старом формате (v1).

**Обработка:**
```typescript
const position = parseReaderPosition(raw);
// Сначала пробуем v2
if (isSemanticPosition(position)) {
  restoreSemanticPosition(position);
} else {
  // Fallback к v1
  restoreByTextOffset(position.textOffset);
  // или
  restoreByScrollPercent(position.scrollTop, position.scrollHeight);
}
```

**Результат:** Обратная совместимость — старые позиции всё ещё работают.

### 6. Очень длинные параграфы (>10000 символов)

**Сценарий:** Параграф занимает несколько экранов, `charOffset` указывает на середину.

**Обработка:**
```typescript
// Находим текстовый узел и offset внутри него
const target = findTextNodeInElement(element, charOffset);
if (target) {
  // Создаём range для точного позиционирования
  const range = document.createRange();
  range.setStart(target.node, target.offset);
  const rect = range.getBoundingClientRect();
  scrollToRect(rect);
}
```

**Результат:** Точное позиционирование даже внутри длинных параграфов.

### 7. Пустые элементы или элементы без текста

**Сценарий:** Пользователь на изображении или пустом блоке.

**Обработка:**
```typescript
const textElement = element.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote');
if (!textElement) {
  // Нет текстового элемента — не сохраняем позицию
  return null;
}
```

**Результат:** Позиция сохраняется только для текстовых элементов.

## Мониторинг и Отладка

В консоль выводятся подробные логи:

```
[DebouncedSave] Captured semantic position: {
  elementPath: "p:nth-of-type(12)",
  elementTag: "p",
  charOffset: 156,
  textPreview: "The quick brown fox jumps over..."
}

[ReaderRestore] Using semantic position (v2): {
  elementPath: "p:nth-of-type(12)",
  chapterPercent: 35
}

[ReaderRestore] Semantic restore result: {
  success: true,
  method: "exact",  // или "element-start", "percent"
  actualElement: <p>
}
```

## API Reference

### captureSemanticPosition(options)

```typescript
interface CapturePositionOptions {
  chapterId: number;
  scrollContainer: HTMLElement;
  contentArea: HTMLElement;
  viewportInset?: number; // default: 8
}

// Returns: SemanticReadingPosition | null
```

### restoreSemanticPosition(options)

```typescript
interface RestorePositionOptions {
  position: SemanticReadingPosition;
  scrollContainer: HTMLElement;
  contentArea: HTMLElement;
  viewportInset?: number; // default: 8
  smooth?: boolean;       // default: false
}

// Returns: RestoreResult
interface RestoreResult {
  success: boolean;
  method: 'exact' | 'element-start' | 'percent' | 'failed';
  actualElement?: HTMLElement;
}
```

## Миграция с v1 на v2

1. **Автоматическая:** Новые позиции сохраняются в v2
2. **Старые позиции:** Продолжают работать через fallback
3. **Постепенная:** Пользователи автоматически мигрируют при чтении

Никаких действий от пользователя не требуется.