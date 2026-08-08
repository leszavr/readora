import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { invalidatePublicBookCoverCache } from "./public-book-cover-service";

export type PopularBook = {
  title: string;
  author: string | null;
  description: string | null;
  coverUrl: string;
};

type PopularBookCandidate = PopularBook & { coverSeed: string };

const CACHE_TTL_MS = 10 * 60 * 1000;
const POPULAR_BOOKS_WINDOW_DAYS = 120;
let cachedBooks: PopularBookCandidate[] | null = null;
let cacheExpiresAt = 0;

type PopularBookRow = {
  title: string;
  author: string | null;
  description: string | null;
  cover_seed: string;
  reader_count: number;
};

function normalizeLimit(limit: unknown): number {
  const parsed = typeof limit === "number" ? limit : Number.parseInt(String(limit), 10);
  if (!Number.isFinite(parsed)) return 6;
  return Math.min(Math.max(Math.trunc(parsed), 1), 12);
}

function normalizeDescription(value: string | null): string | null {
  if (!value) return null;
  const normalized = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 200) : null;
}

async function loadPopularBooks(): Promise<PopularBookCandidate[]> {
  const since = new Date(Date.now() - POPULAR_BOOKS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const result = await db.execute(sql<PopularBookRow>`
    WITH ranked_books AS (
      SELECT
        b.id,
        b.title,
        b.author,
        b.description,
        md5(concat_ws('|', b.title, coalesce(b.author, ''), coalesce(b.description, ''))) AS cover_seed,
        count(DISTINCT re.user_id)::int AS reader_count,
        coalesce(b.file_hash, concat('book:', b.id)) AS identity
      FROM books b
      INNER JOIN read_events re ON re.book_id = b.id AND re.created_at >= ${since}
      WHERE b.status = 'active' AND b.hide_from_popular = false
      GROUP BY b.id
    ),
    deduplicated_books AS (
      SELECT DISTINCT ON (identity) title, author, description, cover_seed, reader_count, id
      FROM ranked_books
      ORDER BY identity, reader_count DESC, id ASC
    )
    SELECT title, author, description, cover_seed, reader_count
    FROM deduplicated_books
    ORDER BY reader_count DESC, title ASC, cover_seed ASC
  `);

  return result.rows.map((row) => {
    const book = row as PopularBookRow;
    return {
      title: book.title,
      author: book.author,
      description: normalizeDescription(book.description),
      coverSeed: book.cover_seed,
      coverUrl: `/api/public/popular-book-covers/${book.cover_seed}.webp`,
    };
  });
}

export async function getPopularBooks(limit?: unknown): Promise<PopularBook[]> {
  const now = Date.now();
  if (!cachedBooks || cacheExpiresAt <= now) {
    cachedBooks = await loadPopularBooks();
    cacheExpiresAt = now + CACHE_TTL_MS;
  }
  return cachedBooks.slice(0, normalizeLimit(limit)).map(({ coverSeed: _coverSeed, ...book }) => book);
}

export async function getPopularBookCover(coverSeed: string): Promise<PopularBookCandidate | null> {
  if (!/^[a-f0-9]{32}$/i.test(coverSeed)) return null;
  if (!cachedBooks || cacheExpiresAt <= Date.now()) {
    cachedBooks = await loadPopularBooks();
    cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  }
  return cachedBooks.find((book) => book.coverSeed === coverSeed) ?? null;
}

export function invalidatePopularBooksCache(): void {
  cachedBooks = null;
  cacheExpiresAt = 0;
  invalidatePublicBookCoverCache();
}
