import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router, type Request } from "express";
import { and, asc, desc, eq, gt, gte, ilike, inArray, lt, lte, or, sql, type SQL } from "drizzle-orm";
import multer from "multer";
import {
  bookGenresTable,
  booksTable,
  catalogEditionsTable,
  catalogGiftOffersTable,
  db,
  genresTable,
  readingProgressTable,
  type usersTable,
} from "@workspace/db";
import { requireAdmin, requireAuth, requireSystemAdmin } from "../middlewares/auth";
import { claimCatalogEdition } from "../lib/gift-editions-service";
import { getCatalogShowcase } from "../lib/catalog-showcase-service";
import { optimizeImage } from "../lib/image-optimizer";
import { resolveUploadPath } from "../lib/storage";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, file.mimetype.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(extension));
  },
});

type AuthReq = Request & { user: typeof usersTable.$inferSelect };
type SortBy = "publishedAt" | "title" | "author" | "publicationYear";
type SortDirection = "asc" | "desc";
type Cursor = { value: string | number; id: number };
type CatalogRow = {
  edition: typeof catalogEditionsTable.$inferSelect;
  book: typeof booksTable.$inferSelect;
  primaryGenre: typeof genresTable.$inferSelect | null;
};

function parseId(value: unknown): number | null {
  const id = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseOptionalId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  return parseId(value);
}

function parseBoolean(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function parseText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function parseYear(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const year = Number.parseInt(String(value), 10);
  return Number.isInteger(year) && year >= 0 && year <= 9999 ? year : undefined;
}

function parseGenreIds(value: unknown): number[] | undefined {
  if (value === undefined) return undefined;
  const values = Array.isArray(value) ? value : String(value).split(",");
  const ids = values.map(parseId).filter((id): id is number => id !== null);
  return [...new Set(ids)];
}

function parseLimit(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? "24"), 10);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 48) : 24;
}

function parseSort(value: unknown): SortBy {
  return value === "title" || value === "author" || value === "publicationYear" ? value : "publishedAt";
}

function parseDirection(value: unknown, sortBy: SortBy): SortDirection {
  if (value === "asc" || value === "desc") return value;
  return sortBy === "publishedAt" || sortBy === "publicationYear" ? "desc" : "asc";
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeCursor(value: unknown): Cursor | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const cursor: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (!cursor || typeof cursor !== "object" || !("id" in cursor) || !("value" in cursor)) return null;
    const { id, value: cursorValue } = cursor as { id: unknown; value: unknown };
    if (typeof id !== "number" || !Number.isSafeInteger(id) || (typeof cursorValue !== "string" && typeof cursorValue !== "number")) return null;
    return { id, value: cursorValue };
  } catch {
    return null;
  }
}

function normalizeStatus(value: unknown): "draft" | "published" | "hidden" | "withdrawn" | undefined {
  return value === "draft" || value === "published" || value === "hidden" || value === "withdrawn" ? value : undefined;
}

function sortExpression(sortBy: SortBy): SQL<string | number> {
  switch (sortBy) {
    case "title":
      return sql<string>`lower(${booksTable.title})`;
    case "author":
      return sql<string>`lower(coalesce(${booksTable.author}, ''))`;
    case "publicationYear":
      return sql<number>`coalesce(${booksTable.publicationYear}, -1)`;
    case "publishedAt":
    default:
      return sql<string>`to_char(${catalogEditionsTable.publishedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;
  }
}

function catalogCoverUrl(id: number, updatedAt: Date): string {
  return `/api/catalog/editions/${id}/cover?v=${updatedAt.getTime()}`;
}

function publicCatalogCoverUrl(id: number, updatedAt: Date): string {
  return `/api/public/catalog-editions/${id}/cover?v=${updatedAt.getTime()}`;
}

async function getGenresBySourceBookIds(sourceBookIds: number[]) {
  if (sourceBookIds.length === 0) return new Map<number, { id: number; code: string; name: string }[]>();
  const rows = await db
    .select({ bookId: bookGenresTable.bookId, genre: genresTable })
    .from(bookGenresTable)
    .innerJoin(genresTable, eq(bookGenresTable.genreId, genresTable.id))
    .where(inArray(bookGenresTable.bookId, sourceBookIds));
  const result = new Map<number, { id: number; code: string; name: string }[]>();
  for (const row of rows) {
    const genres = result.get(row.bookId) ?? [];
    genres.push(row.genre);
    result.set(row.bookId, genres);
  }
  return result;
}

async function getClaimedSourceBookIds(userId: number, sourceBookIds: number[]): Promise<Set<number>> {
  if (sourceBookIds.length === 0) return new Set();
  const rows = await db
    .select({ sourceBookId: booksTable.contentBookId })
    .from(booksTable)
    .where(and(eq(booksTable.ownerUserId, userId), inArray(booksTable.contentBookId, sourceBookIds)));
  return new Set(rows.map((row) => row.sourceBookId).filter((id): id is number => id !== null));
}

async function formatCatalogRows(
  rows: CatalogRow[],
  userId?: number,
) {
  const sourceBookIds = rows.map((row) => row.book.id);
  const [genresBySourceBookId, claimedSourceBookIds] = await Promise.all([
    getGenresBySourceBookIds(sourceBookIds),
    userId === undefined ? Promise.resolve(new Set<number>()) : getClaimedSourceBookIds(userId, sourceBookIds),
  ]);

  return rows.map(({ edition, book, primaryGenre }) => ({
    id: edition.id,
    title: book.title,
    author: book.author ?? null,
    description: book.description ?? null,
    coverUrl: book.coverPath ? catalogCoverUrl(edition.id, book.updatedAt) : null,
    publicCoverUrl: book.coverPath ? publicCatalogCoverUrl(edition.id, book.updatedAt) : null,
    format: book.format,
    language: book.language ?? null,
    publicationYear: book.publicationYear ?? null,
    genres: genresBySourceBookId.get(book.id) ?? [],
    primaryGenre: primaryGenre ? { id: primaryGenre.id, code: primaryGenre.code, name: primaryGenre.name } : null,
    publishedAt: edition.publishedAt,
    isClaimed: claimedSourceBookIds.has(book.id),
    isLandingFeatured: edition.isLandingFeatured,
    landingFeaturedSortOrder: edition.landingFeaturedSortOrder,
    status: edition.status,
  }));
}

async function formatAdminCatalogRows(rows: CatalogRow[]) {
  const sourceBookIds = rows.map((row) => row.book.id);
  const editionIds = rows.map((row) => row.edition.id);
  const [items, copies, offers] = await Promise.all([
    formatCatalogRows(rows),
    sourceBookIds.length === 0 ? [] : db
      .select({ sourceBookId: booksTable.contentBookId, count: sql<number>`count(*)::int` })
      .from(booksTable)
      .where(inArray(booksTable.contentBookId, sourceBookIds))
      .groupBy(booksTable.contentBookId),
    editionIds.length === 0 ? [] : db
      .select({ catalogEditionId: catalogGiftOffersTable.catalogEditionId, isPublished: catalogGiftOffersTable.isPublished, autoGrantOnSignup: catalogGiftOffersTable.autoGrantOnSignup })
      .from(catalogGiftOffersTable)
      .where(inArray(catalogGiftOffersTable.catalogEditionId, editionIds)),
  ]);
  const copiesBySourceBookId = new Map(copies.map((row) => [row.sourceBookId, row.count]));
  const autoGrantByEditionId = new Map(offers.map((offer) => [offer.catalogEditionId, offer.isPublished && offer.autoGrantOnSignup]));

  return items.map((item, index) => ({
    ...item,
    sourceBookId: rows[index].book.id,
    copiesCount: copiesBySourceBookId.get(rows[index].book.id) ?? 0,
    autoGrantOnSignup: autoGrantByEditionId.get(rows[index].edition.id) ?? false,
  }));
}

async function findCatalogEdition(id: number) {
  const [row] = await db
    .select({ edition: catalogEditionsTable, book: booksTable, primaryGenre: genresTable })
    .from(catalogEditionsTable)
    .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
    .leftJoin(genresTable, eq(catalogEditionsTable.primaryGenreId, genresTable.id))
    .where(and(eq(catalogEditionsTable.id, id), eq(booksTable.scope, "catalog_source")));
  return row;
}

// Пользовательский каталог.
router.get("/catalog/editions", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const query = req.query as Record<string, unknown>;
  const q = query.q === undefined ? null : parseText(query.q, 200);
  const author = query.author === undefined ? null : parseText(query.author, 320);
  const genreIds = query.genreId === undefined ? [] : parseGenreIds(query.genreId);
  const yearFrom = query.yearFrom === undefined ? null : parseYear(query.yearFrom);
  const yearTo = query.yearTo === undefined ? null : parseYear(query.yearTo);
  const sortBy = parseSort(query.sortBy);
  const sortDir = parseDirection(query.sortDir, sortBy);
  const cursor = decodeCursor(query.cursor);
  const limit = parseLimit(query.limit);

  if (q === undefined || author === undefined || yearFrom === undefined || yearTo === undefined || genreIds === undefined) {
    res.status(400).json({ error: "Некорректные параметры каталога" });
    return;
  }
  if (yearFrom !== null && yearTo !== null && yearFrom > yearTo) {
    res.status(400).json({ error: "Начальный год не может быть больше конечного" });
    return;
  }
  if (query.cursor !== undefined && !cursor) {
    res.status(400).json({ error: "Некорректный курсор" });
    return;
  }

  const key = sortExpression(sortBy);
  const baseConditions: (SQL | undefined)[] = [
    eq(catalogEditionsTable.status, "published"),
    eq(booksTable.scope, "catalog_source"),
    eq(booksTable.status, "active"),
    q ? or(ilike(booksTable.title, `%${q}%`), ilike(booksTable.author, `%${q}%`)) : undefined,
    author ? ilike(booksTable.author, `%${author}%`) : undefined,
    genreIds.length > 0 ? sql`exists (select 1 from ${bookGenresTable} bg where bg.book_id = ${booksTable.id} and bg.genre_id in (${sql.join(genreIds.map((id) => sql`${id}`), sql`, `)}))` : undefined,
    yearFrom !== null ? gte(booksTable.publicationYear, yearFrom) : undefined,
    yearTo !== null ? lte(booksTable.publicationYear, yearTo) : undefined,
  ];
  const cursorCondition = cursor
    ? (sortDir === "asc"
      ? or(gt(key, cursor.value), and(eq(key, cursor.value), gt(catalogEditionsTable.id, cursor.id)))
      : or(lt(key, cursor.value), and(eq(key, cursor.value), lt(catalogEditionsTable.id, cursor.id))))
    : undefined;
  const rows = await db
    .select({ edition: catalogEditionsTable, book: booksTable, primaryGenre: genresTable, sortValue: key })
    .from(catalogEditionsTable)
    .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
    .leftJoin(genresTable, eq(catalogEditionsTable.primaryGenreId, genresTable.id))
    .where(and(...baseConditions, cursorCondition))
    .orderBy(sortDir === "asc" ? asc(key) : desc(key), sortDir === "asc" ? asc(catalogEditionsTable.id) : desc(catalogEditionsTable.id))
    .limit(limit + 1);
  const pageRows = rows.slice(0, limit);
  const items = await formatCatalogRows(pageRows, user.id);
  const last = pageRows.at(-1);
  res.json({
    items,
    hasNextPage: rows.length > limit,
    nextCursor: rows.length > limit && last ? encodeCursor({ value: last.sortValue, id: last.edition.id }) : null,
  });
});

router.get("/catalog/editions/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Некорректный идентификатор" }); return; }
  const row = await findCatalogEdition(id);
  if (!row || row.edition.status !== "published" || row.book.status !== "active" || row.book.scope !== "catalog_source") { res.status(404).json({ error: "Издание не найдено" }); return; }
  const [edition] = await formatCatalogRows([row], (req as AuthReq).user.id);
  res.json(edition);
});

router.post("/catalog/editions/:id/claim", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Некорректный идентификатор" }); return; }
  const added = await claimCatalogEdition((req as AuthReq).user.id, id);
  if (added === 0) {
    const row = await findCatalogEdition(id);
    if (!row || row.edition.status !== "published" || row.book.status !== "active" || row.book.scope !== "catalog_source") { res.status(404).json({ error: "Издание не найдено" }); return; }
  }
  res.json({ added });
});

router.get("/catalog/editions/:id/cover", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.sendStatus(404); return; }
  const row = await findCatalogEdition(id);
  const user = (req as AuthReq).user;
  const isPubliclyVisible = row?.edition.status === "published" && row.book.status === "active";
  if (!row || !row.book.coverPath || (!isPubliclyVisible && user.role !== "admin")) { res.sendStatus(404); return; }
  const filePath = resolveUploadPath(row.book.coverPath);
  if (!fs.existsSync(filePath)) { res.sendStatus(404); return; }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "private, no-cache");
  fs.createReadStream(filePath).pipe(res);
});

router.get("/public/catalog-showcase", async (_req, res): Promise<void> => {
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json(await getCatalogShowcase());
});

router.get("/public/catalog-editions/:id/cover", async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.sendStatus(404); return; }
  const row = await findCatalogEdition(id);
  if (!row || row.edition.status !== "published" || row.book.status !== "active" || row.book.scope !== "catalog_source" || !row.book.coverPath) { res.sendStatus(404); return; }
  const filePath = resolveUploadPath(row.book.coverPath);
  if (!fs.existsSync(filePath)) { res.sendStatus(404); return; }
  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "public, max-age=3600");
  fs.createReadStream(filePath).pipe(res);
});

// Административное управление каталогом.
router.get("/admin/catalog-editions", requireAdmin, async (_req, res): Promise<void> => {
  const rows = await db
    .select({ edition: catalogEditionsTable, book: booksTable, primaryGenre: genresTable })
    .from(catalogEditionsTable)
    .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
    .leftJoin(genresTable, eq(catalogEditionsTable.primaryGenreId, genresTable.id))
    .where(eq(booksTable.scope, "catalog_source"))
    .orderBy(desc(catalogEditionsTable.publishedAt), desc(catalogEditionsTable.createdAt));
  res.json(await formatAdminCatalogRows(rows));
});

router.patch("/admin/catalog-editions/:id", requireSystemAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Некорректный идентификатор" }); return; }
  const current = await findCatalogEdition(id);
  if (!current) { res.status(404).json({ error: "Каталожное издание не найдено" }); return; }
  const title = parseText(req.body?.title, 500);
  const author = parseText(req.body?.author, 500);
  const description = parseText(req.body?.description, 10_000);
  const language = parseText(req.body?.language, 100);
  const publicationYear = parseYear(req.body?.publicationYear);
  const primaryGenreId = parseOptionalId(req.body?.primaryGenreId);
  const genreIds = parseGenreIds(req.body?.genreIds);
  const status = normalizeStatus(req.body?.status);
  const isLandingFeatured = parseBoolean(req.body?.isLandingFeatured);
  const autoGrantOnSignup = parseBoolean(req.body?.autoGrantOnSignup);
  const landingFeaturedSortOrder = req.body?.landingFeaturedSortOrder === undefined ? undefined : Number.parseInt(String(req.body.landingFeaturedSortOrder), 10);

  if (title === undefined || author === undefined || description === undefined || language === undefined || publicationYear === undefined || primaryGenreId === undefined || genreIds === undefined || req.body?.status !== undefined && !status || req.body?.autoGrantOnSignup !== undefined && autoGrantOnSignup === undefined) {
    res.status(400).json({ error: "Некорректные данные издания" });
    return;
  }
  if (title === null || (landingFeaturedSortOrder !== undefined && (!Number.isInteger(landingFeaturedSortOrder) || landingFeaturedSortOrder < 0 || landingFeaturedSortOrder > 10_000))) {
    res.status(400).json({ error: "Проверьте название и порядок отображения" });
    return;
  }
  if (primaryGenreId) {
    const [genre] = await db.select({ id: genresTable.id }).from(genresTable).where(eq(genresTable.id, primaryGenreId));
    if (!genre) { res.status(400).json({ error: "Основной жанр не найден" }); return; }
  }
  if (genreIds !== undefined && genreIds.length > 0) {
    const existingGenres = await db.select({ id: genresTable.id }).from(genresTable).where(inArray(genresTable.id, genreIds));
    if (existingGenres.length !== genreIds.length) { res.status(400).json({ error: "Один или несколько жанров не найдены" }); return; }
  }

  await db.transaction(async (tx) => {
    const bookUpdates: Partial<typeof booksTable.$inferInsert> = {};
    if (title !== undefined && title !== null) bookUpdates.title = title;
    if (author !== undefined) bookUpdates.author = author;
    if (description !== undefined) bookUpdates.description = description;
    if (language !== undefined) bookUpdates.language = language;
    if (publicationYear !== undefined) bookUpdates.publicationYear = publicationYear;
    if (Object.keys(bookUpdates).length > 0) await tx.update(booksTable).set(bookUpdates).where(eq(booksTable.id, current.book.id));
    if (genreIds !== undefined) {
      await tx.delete(bookGenresTable).where(eq(bookGenresTable.bookId, current.book.id));
      if (genreIds.length > 0) await tx.insert(bookGenresTable).values(genreIds.map((genreId) => ({ bookId: current.book.id, genreId }))).onConflictDoNothing();
    }
    const editionUpdates: Partial<typeof catalogEditionsTable.$inferInsert> = {};
    if (primaryGenreId !== undefined) editionUpdates.primaryGenreId = primaryGenreId;
    if (isLandingFeatured !== undefined) editionUpdates.isLandingFeatured = isLandingFeatured;
    if (landingFeaturedSortOrder !== undefined) editionUpdates.landingFeaturedSortOrder = landingFeaturedSortOrder;
    if (status) {
      editionUpdates.status = status;
      if (status === "published" && !current.edition.publishedAt) editionUpdates.publishedAt = new Date();
    }
    if (Object.keys(editionUpdates).length > 0) await tx.update(catalogEditionsTable).set(editionUpdates).where(eq(catalogEditionsTable.id, id));
    if (autoGrantOnSignup === true) {
      await tx
        .insert(catalogGiftOffersTable)
        .values({ catalogEditionId: id, isPublished: true, autoGrantOnSignup: true, availableFrom: null, availableUntil: null })
        .onConflictDoUpdate({
          target: catalogGiftOffersTable.catalogEditionId,
          set: { isPublished: true, autoGrantOnSignup: true, availableFrom: null, availableUntil: null },
        });
    } else if (autoGrantOnSignup === false) {
      await tx
        .update(catalogGiftOffersTable)
        .set({ isPublished: false, autoGrantOnSignup: false })
        .where(eq(catalogGiftOffersTable.catalogEditionId, id));
    }
  });
  const row = await findCatalogEdition(id);
  if (!row) { res.status(404).json({ error: "Каталожное издание не найдено" }); return; }
  const [item] = await formatAdminCatalogRows([row]);
  res.json(item);
});

router.post("/admin/catalog-editions/:id/cover", requireSystemAdmin, upload.single("cover"), async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id || !req.file) { res.status(400).json({ error: "Загрузите корректную обложку" }); return; }
  const row = await findCatalogEdition(id);
  if (!row) { res.status(404).json({ error: "Каталожное издание не найдено" }); return; }
  const optimized = await optimizeImage(req.file.buffer, "cover");
  const hash = crypto.createHash("sha256").update(optimized.buffer).digest("hex");
  const coverPath = `covers/catalog-${hash}.webp`;
  fs.writeFileSync(resolveUploadPath(coverPath), optimized.buffer);
  await db.update(booksTable).set({ coverPath }).where(eq(booksTable.id, row.book.id));
  if (row.book.coverPath && row.book.coverPath !== coverPath) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(booksTable).where(eq(booksTable.coverPath, row.book.coverPath));
    if (count === 1) fs.rmSync(resolveUploadPath(row.book.coverPath), { force: true });
  }
  const updated = await findCatalogEdition(id);
  if (!updated) { res.status(404).json({ error: "Каталожное издание не найдено" }); return; }
  const [item] = await formatAdminCatalogRows([updated]);
  res.json(item);
});

router.delete("/admin/catalog-editions/:id", requireSystemAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Некорректный идентификатор" }); return; }
  const [edition] = await db.update(catalogEditionsTable).set({ status: "withdrawn", isLandingFeatured: false }).where(eq(catalogEditionsTable.id, id)).returning();
  if (!edition) { res.status(404).json({ error: "Каталожное издание не найдено" }); return; }
  res.sendStatus(204);
});

export default router;
