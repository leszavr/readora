import { and, asc, eq } from "drizzle-orm";
import { db, landingBooksTable } from "@workspace/db";

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

async function loadPopularBooks(): Promise<PopularBook[]> {
  const books = await db
    .select()
    .from(landingBooksTable)
    .where(eq(landingBooksTable.isPublished, true))
    .orderBy(asc(landingBooksTable.sortOrder), asc(landingBooksTable.id));

  return books.map((book) => ({
    title: book.title,
    author: book.author,
    description: book.description,
    coverUrl: `/api/public/landing-book-covers/${book.id}?v=${book.updatedAt.getTime()}`,
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
