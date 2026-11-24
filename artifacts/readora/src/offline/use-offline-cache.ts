// React-слой офлайн-кэша: единственные точки соприкосновения офлайн-модуля
// с основным кодом приложения (AGENTS.md §11.2). Хуки клиентские; модули
// IndexedDB подгружаются динамически, чтобы не попадать в SSR-бандл лендинга.

import { useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { Book } from "@workspace/api-client-react";

export const OFFLINE_BOOKS_QUERY_KEY = ["offline-books"] as const;

/** Форматы, поддерживаемые офлайн-ридером (ADR-0001; MOBI отложен). */
const OFFLINE_SUPPORTED_FORMATS = new Set(["fb2", "epub", "cbz", "txt", "md", "html"]);

export function isOfflineSupportedFormat(format: string): boolean {
  return OFFLINE_SUPPORTED_FORMATS.has(format.toLowerCase());
}

export function invalidateOfflineBooksQuery(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: OFFLINE_BOOKS_QUERY_KEY });
}

/** id книг, доступных офлайн (для индикаторов в библиотеке). */
export function useOfflineBookIds(): Set<number> {
  const { data } = useQuery({
    queryKey: OFFLINE_BOOKS_QUERY_KEY,
    queryFn: async () => {
      const { listCachedBooks } = await import("./db");
      return (await listCachedBooks()).map((book) => book.bookId);
    },
    staleTime: Infinity,
  });
  return data ? new Set(data) : new Set();
}

/**
 * Фоновое кэширование начатой книги при чтении онлайн (ADR-0001.5):
 * уже закэшированную — только «трогаем» (LRU) и обновляем прогресс.
 */
export function useOfflineBookCache(book: Book | undefined): void {
  const qc = useQueryClient();

  useEffect(() => {
    if (!book || !isOfflineSupportedFormat(book.format)) return;
    const started = (book.progressPercent ?? 0) > 0 || book.readingStatus === "reading";
    if (!started) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;

    let cancelled = false;
    void (async () => {
      const { getCachedBook } = await import("./db");
      const { cacheBook, touchCachedBook } = await import("./book-cache");
      const existing = await getCachedBook(book.id);
      if (cancelled) return;
      if (existing) {
        await touchCachedBook(book.id, book.progressPercent ?? existing.progressPercent);
      } else {
        await cacheBook({
          id: book.id,
          title: book.title,
          author: book.author ?? null,
          format: book.format,
          fileSize: book.fileSize ?? 0,
          progressPercent: book.progressPercent ?? 0,
          coverUrl: book.coverUrl,
        }).catch(() => undefined);
      }
      if (!cancelled) invalidateOfflineBooksQuery(qc);
    })();

    return () => {
      cancelled = true;
    };
  }, [book, qc]);
}
