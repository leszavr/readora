import { Router, type Request, type Response } from "express";
import { and, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { bookGenresTable, booksTable, db, genresTable, readingHistoryTable, usersTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { normalizeBookIds } from "../lib/book-deletion-service";
import { deleteUnreferencedHistoryCovers, sendStoredCover } from "../lib/cover-storage";
import {
  normalizeReadingHistoryComment,
  parseReadingHistoryListQuery,
  resolveReadingHistorySort,
  type ReadingHistoryListParams,
  type ReadingHistorySortField,
} from "../lib/reading-history";

const router = Router();
type AuthReq = Request & { user: typeof usersTable.$inferSelect };

const titleExpr = sql<string>`coalesce(${booksTable.title}, ${readingHistoryTable.title})`;
const authorExpr = sql<string | null>`coalesce(${booksTable.author}, ${readingHistoryTable.author})`;
const cycleNameExpr = sql<string | null>`coalesce(${booksTable.cycleName}, ${readingHistoryTable.cycleName})`;
const genreNameExpr = sql<string | null>`coalesce(
  (select g."name" from ${bookGenresTable} bg
     join ${genresTable} g on g."id" = bg."genre_id"
     where bg."book_id" = ${booksTable.id}
     order by bg."genre_id" limit 1),
  ${readingHistoryTable.genreName}
)`;

const sortExpressions: Record<ReadingHistorySortField, SQL> = {
  completedAt: sql`${readingHistoryTable.completedAt}`,
  title: titleExpr,
  author: authorExpr,
  genre: genreNameExpr,
  cycle: cycleNameExpr,
};

const entrySelection = {
  id: readingHistoryTable.id,
  bookId: readingHistoryTable.bookId,
  title: titleExpr,
  author: authorExpr,
  cycleName: cycleNameExpr,
  genreName: genreNameExpr,
  bookCoverPath: booksTable.coverPath,
  historyCoverPath: readingHistoryTable.coverPath,
  completedAt: readingHistoryTable.completedAt,
  comment: readingHistoryTable.comment,
};

function selectReadingHistoryRows() {
  return db
    .select(entrySelection)
    .from(readingHistoryTable)
    .leftJoin(booksTable, eq(booksTable.id, readingHistoryTable.bookId));
}

type EntryRow = Awaited<ReturnType<typeof selectReadingHistoryRows>>[number];

function toReadingHistoryEntry(row: EntryRow) {
  const coverPath = row.bookCoverPath ?? row.historyCoverPath;
  const usesBookCover = row.bookId !== null && row.bookCoverPath !== null;
  const coverUrl = !coverPath
    ? null
    : usesBookCover
      ? `/api/books/${row.bookId}/cover?v=${encodeURIComponent(coverPath)}`
      : `/api/reading-history/${row.id}/cover?v=${encodeURIComponent(coverPath)}`;

  return {
    id: row.id,
    bookId: row.bookId,
    title: row.title,
    author: row.author,
    coverUrl,
    cycleName: row.cycleName,
    genreName: row.genreName,
    completedAt: row.completedAt.toISOString(),
    comment: row.comment,
  };
}

function parseEntryId(value: unknown): number | null {
  const id = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function resolveOrderBy(params: ReadingHistoryListParams): SQL[] {
  return resolveReadingHistorySort(params).map((key) => {
    const expression = sortExpressions[key.field];
    return key.dir === "desc" ? sql`${expression} desc nulls last` : sql`${expression} asc nulls last`;
  });
}

// GET /reading-history
router.get("/reading-history", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const parsedQuery = parseReadingHistoryListQuery(req.query as Record<string, unknown>);
  if (!parsedQuery.valid) {
    res.status(400).json({ error: parsedQuery.error });
    return;
  }
  const { params } = parsedQuery;

  const conditions = [eq(readingHistoryTable.userId, user.id)];
  if (params.search) {
    const pattern = `%${params.search}%`;
    conditions.push(or(ilike(titleExpr, pattern), ilike(authorExpr, pattern))!);
  }

  const rows = await selectReadingHistoryRows()
    .where(and(...conditions))
    .orderBy(...resolveOrderBy(params));

  res.json(rows.map(toReadingHistoryEntry));
});

// POST /reading-history/delete-bulk
router.post("/reading-history/delete-bulk", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const ids = normalizeBookIds(req.body?.ids);
  if (!ids) {
    res.status(400).json({ error: "Передайте от 1 до 500 корректных ID записей" });
    return;
  }

  const deleted = await db
    .delete(readingHistoryTable)
    .where(and(eq(readingHistoryTable.userId, user.id), inArray(readingHistoryTable.id, ids)))
    .returning({ coverPath: readingHistoryTable.coverPath });

  await deleteUnreferencedHistoryCovers(deleted.flatMap((row) => (row.coverPath ? [row.coverPath] : [])));
  res.json({ deleted: deleted.length });
});

// POST /reading-history/clear
router.post("/reading-history/clear", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;

  const deleted = await db
    .delete(readingHistoryTable)
    .where(eq(readingHistoryTable.userId, user.id))
    .returning({ coverPath: readingHistoryTable.coverPath });

  await deleteUnreferencedHistoryCovers(deleted.flatMap((row) => (row.coverPath ? [row.coverPath] : [])));
  res.json({ deleted: deleted.length });
});

// PATCH /reading-history/:id
router.patch("/reading-history/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const id = parseEntryId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Некорректный id записи" });
    return;
  }

  const body: unknown = req.body;
  if (typeof body !== "object" || body === null || !("comment" in body)) {
    res.status(400).json({ error: "Передайте комментарий" });
    return;
  }

  const parsedComment = normalizeReadingHistoryComment((body as { comment: unknown }).comment);
  if (!parsedComment.valid) {
    res.status(400).json({ error: parsedComment.error });
    return;
  }

  const updated = await db
    .update(readingHistoryTable)
    .set({ comment: parsedComment.comment })
    .where(and(eq(readingHistoryTable.id, id), eq(readingHistoryTable.userId, user.id)))
    .returning({ id: readingHistoryTable.id });
  if (updated.length === 0) {
    res.status(404).json({ error: "Запись не найдена" });
    return;
  }

  const [row] = await selectReadingHistoryRows().where(eq(readingHistoryTable.id, id));
  res.json(toReadingHistoryEntry(row));
});

// GET /reading-history/:id/cover
router.get("/reading-history/:id/cover", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const id = parseEntryId(req.params.id);
  if (id === null) {
    res.status(400).json({ error: "Некорректный id записи" });
    return;
  }

  const [entry] = await db
    .select({ coverPath: readingHistoryTable.coverPath })
    .from(readingHistoryTable)
    .where(and(eq(readingHistoryTable.id, id), eq(readingHistoryTable.userId, user.id)));

  if (!entry?.coverPath || !sendStoredCover(res, entry.coverPath)) {
    res.status(404).json({ error: "Обложка не найдена" });
  }
});

export default router;
