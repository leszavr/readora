// Кэш книг для офлайн-чтения: загрузка файла + обложки + метаданных с сервера
// в IndexedDB, LRU-вытеснение и инвалидация. См. docs/offline/plan.md этап 1,
// docs/offline/adr-0001-offline-mode.md.

import {
  type OfflineBook,
  type OfflineCachedBook,
  cachedBookId,
  deleteOfflineBook,
  getCachedBook,
  listCachedBooks,
  putOfflineBook,
} from "./db";

/** Минимум полей книги, нужных кэшу (совместимо с типом Book из API-клиента). */
export type CacheableBookMeta = {
  id: number;
  title: string;
  author: string | null;
  format: string;
  fileSize: number;
  progressPercent: number;
  coverUrl?: string | null;
};

/** Выбор жертв LRU: только закэшированные книги, по возрастанию lastAccessAt. */
export function selectEvictionCandidates(books: OfflineBook[], count: number, excludeIds: string[] = []): string[] {
  const excluded = new Set(excludeIds);
  const cached = books
    .filter((book): book is OfflineCachedBook => book.kind === "cached" && !excluded.has(book.id))
    .sort((left, right) => left.lastAccessAt - right.lastAccessAt);
  return cached.slice(0, Math.max(0, count)).map((book) => book.id);
}

function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException
    && (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED");
}

async function fetchBookFile(bookId: number): Promise<Blob> {
  const response = await fetch(`/api/books/${bookId}/file`, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Не удалось скачать файл книги (${response.status})`);
  }
  return response.blob();
}

async function fetchCover(coverUrl: string): Promise<Blob | null> {
  try {
    const response = await fetch(coverUrl, { credentials: "include" });
    if (!response.ok) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

async function putWithEviction(book: OfflineCachedBook): Promise<void> {
  try {
    await putOfflineBook(book);
  } catch (error) {
    if (!isQuotaError(error)) throw error;
    // Квота переполнена: вытесняем половину самых старых закэшированных книг и повторяем.
    const all = await listCachedBooks();
    const victims = selectEvictionCandidates(all, Math.max(1, Math.floor(all.length / 2)), [book.id]);
    for (const victimId of victims) {
      await deleteOfflineBook(victimId);
    }
    await putOfflineBook(book);
  }
}

/**
 * Закэшировать книгу с сервера (файл + обложка + метаданные).
 * Вызывается в фоне при открытии книги онлайн; ошибки — caller-е.
 */
export async function cacheBook(book: CacheableBookMeta): Promise<void> {
  const [file, cover] = await Promise.all([
    fetchBookFile(book.id),
    book.coverUrl ? fetchCover(book.coverUrl) : Promise.resolve(null),
  ]);
  const now = Date.now();
  await putWithEviction({
    id: cachedBookId(book.id),
    kind: "cached",
    bookId: book.id,
    title: book.title,
    author: book.author,
    format: book.format,
    fileSize: book.fileSize,
    cover,
    file,
    progressPercent: book.progressPercent,
    lastAccessAt: now,
    cachedAt: now,
  });
}

/** Обновить время последнего доступа (LRU) и свежий прогресс книги. */
export async function touchCachedBook(bookId: number, progressPercent?: number): Promise<void> {
  const book = await getCachedBook(bookId);
  if (!book) return;
  await putOfflineBook({
    ...book,
    lastAccessAt: Date.now(),
    ...(progressPercent === undefined ? {} : { progressPercent }),
  });
}

/**
 * Файл и обложка закэшированной книги для чтения; обновляет lastAccessAt.
 * null — книга не в кэше.
 */
export async function takeCachedBookForReading(bookId: number): Promise<{ file: Blob; cover: Blob | null } | null> {
  const book = await getCachedBook(bookId);
  if (!book) return null;
  await putOfflineBook({ ...book, lastAccessAt: Date.now() });
  return { file: book.file, cover: book.cover };
}

/** Удалить книгу из кэша (книга удалена/заменена на сервере, ручное удаление). */
export async function invalidateCachedBook(bookId: number): Promise<void> {
  await deleteOfflineBook(cachedBookId(bookId));
}
