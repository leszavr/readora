import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db, booksTable, giftEditionsTable } from "@workspace/db";

export type PopularBook = {
  title: string;
  author: string | null;
  description: string | null;
  coverUrl: string;
};

const CACHE_TTL_MS = 10 * 60 * 1000;
let cachedBooks: PopularBook[] | null = null;
let cacheExpiresAt = 0;

function normalizeLimit(limit: unknown): number {
  const parsed = typeof limit === "number" ? limit : Number.parseInt(String(limit), 10);
  if (!Number.isFinite(parsed)) return 6;
  return Math.min(Math.max(Math.trunc(parsed), 1), 12);
}

// Публичный лендинг показывает только опубликованные подарочные издания
// с загруженной вручную обложкой (которая не нарушает авторских прав).
async function loadPopularBooks(): Promise<PopularBook[]> {
  const rows = await db
    .select({
      title: booksTable.title,
      author: booksTable.author,
      description: booksTable.description,
      coverPath: booksTable.coverPath,
      bookId: booksTable.id,
      coverVersion: booksTable.updatedAt,
    })
    .from(giftEditionsTable)
    .innerJoin(booksTable, eq(giftEditionsTable.bookId, booksTable.id))
    .where(and(eq(giftEditionsTable.isPublished, true), isNotNull(booksTable.coverPath)))
    .orderBy(desc(giftEditionsTable.createdAt), desc(giftEditionsTable.id))
    .limit(12);

  return rows.map((book) => ({
    title: book.title,
    author: book.author,
    description: book.description,
    coverUrl: `/api/public/gift-book-covers/${book.bookId}?v=${book.coverVersion.getTime()}`,
  }));
}

export async function getPopularBooks(limit?: unknown): Promise<PopularBook[]> {
  const now = Date.now();
  if (!cachedBooks || cacheExpiresAt <= now) {
    cachedBooks = await loadPopularBooks();
    cacheExpiresAt = now + CACHE_TTL_MS;
  }
  return cachedBooks.slice(0, normalizeLimit(limit));
}

export function invalidatePopularBooksCache(): void {
  cachedBooks = null;
  cacheExpiresAt = 0;
}
