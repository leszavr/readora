import { Router } from "express";
import { eq, and, ilike, inArray, desc, asc, sql, notInArray } from "drizzle-orm";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { db, booksTable, bookGenresTable, genresTable, cyclesTable, readingProgressTable, readEventsTable, chaptersTable, bookUploadJobsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { parseBook } from "../lib/parser";
import { resolveGenreIds } from "../lib/genre-resolver";
import { ensureStorageDirs, resolveUploadPath, tempUploadsDir } from "../lib/storage";
import { optimizeImage } from "../lib/image-optimizer";
import type { Request } from "express";
import type { usersTable } from "@workspace/db";

const router = Router();

ensureStorageDirs();

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "file") {
      if (ext === ".fb2" || ext === ".epub") cb(null, true);
      else cb(new Error("Поддерживаются только FB2 и EPUB файлы"));
      return;
    }

    if (file.fieldname === "cover") {
      if (file.mimetype.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error("Обложка должна быть изображением"));
      }
      return;
    }

    cb(new Error("Неподдерживаемый тип файла"));
  },
});

type AuthReq = Request & { user: typeof usersTable.$inferSelect };

function toUploadJobResponse(job: typeof bookUploadJobsTable.$inferSelect) {
  return {
    id: job.id,
    originalFilename: job.originalFilename,
    fileSize: job.fileSize,
    format: job.format,
    status: job.status,
    stage: job.stage,
    progress: Math.round(job.progress),
    errorMessage: job.errorMessage,
    bookId: job.bookId,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
  };
}

async function updateUploadJob(jobId: number, values: Partial<typeof bookUploadJobsTable.$inferInsert>): Promise<void> {
  await db.update(bookUploadJobsTable).set(values).where(eq(bookUploadJobsTable.id, jobId));
}

async function deleteStoredFilesIfUnreferenced(book: typeof booksTable.$inferSelect, excludingBookIds: number[] = [book.id]): Promise<void> {
  const [{ count: sameFileCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(booksTable)
    .where(and(eq(booksTable.storageKey, book.storageKey), notInArray(booksTable.id, excludingBookIds)));
  if (sameFileCount === 0) {
    fs.rmSync(resolveUploadPath(book.storageKey), { force: true });
  }

  if (book.coverPath) {
    const [{ count: sameCoverCount }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(booksTable)
      .where(and(eq(booksTable.coverPath, book.coverPath), notInArray(booksTable.id, excludingBookIds)));
    if (sameCoverCount === 0) {
      fs.rmSync(resolveUploadPath(book.coverPath), { force: true });
    }
  }
}

async function deleteCoverIfUnreferenced(coverPath: string, excludingBookIds: number[]): Promise<void> {
  const [{ count: sameCoverCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(booksTable)
    .where(and(eq(booksTable.coverPath, coverPath), notInArray(booksTable.id, excludingBookIds)));

  if (sameCoverCount === 0) {
    fs.rmSync(resolveUploadPath(coverPath), { force: true });
  }
}

function buildCoverUrl(bookId: number, coverPath: string, isPublic = false): string {
  const route = isPublic ? "cover-public" : "cover";
  // coverPath contains hashed filename, so this query param busts browser cache after replacement.
  return `/api/books/${bookId}/${route}?v=${encodeURIComponent(coverPath)}`;
}

async function storeOptimizedCover(inputBuffer: Buffer, filePrefix: string): Promise<string> {
  const optimized = await optimizeImage(inputBuffer, "cover");
  const coverHash = crypto.createHash("sha256").update(optimized.buffer).digest("hex");
  const coverStorageKey = `covers/${filePrefix}-${coverHash}.webp`;
  fs.writeFileSync(resolveUploadPath(coverStorageKey), optimized.buffer);
  return coverStorageKey;
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function coerceText(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") return String(value);
  return undefined;
}

function parseNullableInt(value: unknown): number | null | undefined {
  if (value === null || value === "null" || value === "") return null;
  return parseOptionalNumber(value);
}

function parseNullableFloat(value: unknown): number | null | undefined {
  if (value === null || value === "null" || value === "") return null;
  const text = coerceText(value);
  if (text === undefined) return undefined;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseGenreIds(value: unknown): number[] | undefined {
  if (value == null || value === "") return undefined;

  if (Array.isArray(value)) {
    const ids = value.map((item) => Number.parseInt(String(item), 10)).filter(Number.isFinite);
    return ids.length > 0 ? ids : [];
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const ids = parsed.map((item) => Number.parseInt(String(item), 10)).filter(Number.isFinite);
        return ids.length > 0 ? ids : [];
      }
    } catch {
      return [];
    }
  }

  return [];
}

async function applyBookUpdates(params: {
  book: typeof booksTable.$inferSelect;
  body: Record<string, unknown>;
  file?: Express.Multer.File;
}): Promise<void> {
  const { book, body, file } = params;
  const updates: Partial<typeof booksTable.$inferSelect> = {};

  const title = coerceText(body.title);
  const author = coerceText(body.author);
  const description = coerceText(body.description);
  const language = coerceText(body.language);

  if (title !== undefined) updates.title = title;
  if (body.author !== undefined) updates.author = author ?? null;
  if (body.description !== undefined) updates.description = description ?? null;
  if (body.language !== undefined) updates.language = language ?? null;

  const publicationYear = parseOptionalNumber(body.publicationYear);
  const cycleId = parseNullableInt(body.cycleId);
  const cycleNumber = parseNullableFloat(body.cycleNumber);
  const genreIds = parseGenreIds(body.genreIds);

  if (publicationYear !== undefined) updates.publicationYear = publicationYear;
  if (cycleId !== undefined) updates.cycleId = cycleId;
  if (cycleNumber !== undefined) updates.cycleNumber = cycleNumber;

  if (file) {
    updates.coverPath = await storeOptimizedCover(file.buffer, `book-${book.id}`);
  }

  await db.update(booksTable).set(updates).where(eq(booksTable.id, book.id));

  if (genreIds !== undefined) {
    await db.delete(bookGenresTable).where(eq(bookGenresTable.bookId, book.id));
    if (genreIds.length > 0) {
      await db.insert(bookGenresTable).values(genreIds.map((gId: number) => ({ bookId: book.id, genreId: gId }))).onConflictDoNothing();
    }
  }

  if (file && book.coverPath && book.coverPath !== updates.coverPath) {
    await deleteCoverIfUnreferenced(book.coverPath, [book.id]);
  }
}

// Helper: get book with genres and progress
async function getBookWithDetails(bookId: number, userId: number) {
  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, bookId));
  if (!book) return null;

  const genreRows = await db
    .select({ genre: genresTable })
    .from(bookGenresTable)
    .innerJoin(genresTable, eq(bookGenresTable.genreId, genresTable.id))
    .where(eq(bookGenresTable.bookId, bookId));

  const [progress] = await db
    .select()
    .from(readingProgressTable)
    .where(and(eq(readingProgressTable.userId, userId), eq(readingProgressTable.bookId, bookId)));

  const [cycle] = book.cycleId
    ? await db.select().from(cyclesTable).where(eq(cyclesTable.id, book.cycleId))
    : [null];

  const chapterCountResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(chaptersTable)
    .where(eq(chaptersTable.bookId, bookId));
  const chapterCount = chapterCountResult[0]?.count ?? 0;

  return {
    id: book.id,
    title: book.title,
    author: book.author ?? null,
    description: book.description ?? null,
    coverUrl: book.coverPath ? buildCoverUrl(book.id, book.coverPath) : null,
    format: book.format,
    language: book.language ?? null,
    publicationYear: book.publicationYear ?? null,
    status: book.status,
    cycleId: book.cycleId ?? null,
    cycleName: cycle?.name ?? book.cycleName ?? null,
    cycleNumber: book.cycleNumber ?? null,
    fileSize: book.fileSize,
    wordCount: null as number | null,
    chapterCount,
    genres: genreRows.map((r) => r.genre),
    readingStatus: progress?.readingStatus ?? null,
    progressPercent: progress?.progressPercent ?? null,
    lastReadAt: progress?.lastReadAt ?? null,
    uploadedAt: book.uploadedAt,
  };
}

async function processBookUploadJob(jobId: number): Promise<void> {
  const [job] = await db.select().from(bookUploadJobsTable).where(eq(bookUploadJobsTable.id, jobId));
  if (!job?.status || job.status !== "queued") return;

  const tempPath = path.join(tempUploadsDir, job.tempStorageKey);

  try {
    await updateUploadJob(jobId, { status: "processing", stage: "validating", progress: 15, errorMessage: null });

    const buffer = fs.readFileSync(tempPath);
    const ext = job.format as "fb2" | "epub";
    const fileHash = crypto.createHash("sha256").update(buffer).digest("hex");
    const storageKey = `${fileHash}.${ext}`;
    const filePath = resolveUploadPath(storageKey);

    await updateUploadJob(jobId, { stage: "parsing", progress: 35 });
    const parsed = parseBook(buffer, ext);

    await updateUploadJob(jobId, { stage: "saving", progress: 80 });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }

    let finalCycleId: number | null = null;
    let finalCycleName: string | null = null;
    if (job.cycleId) {
      finalCycleId = job.cycleId;
    } else if (job.cycleName) {
      const [existingCycle] = await db.select().from(cyclesTable).where(and(eq(cyclesTable.ownerUserId, job.ownerUserId), eq(cyclesTable.name, job.cycleName)));
      if (existingCycle) {
        finalCycleId = existingCycle.id;
      } else {
        const [newCycle] = await db.insert(cyclesTable).values({ ownerUserId: job.ownerUserId, name: job.cycleName }).returning();
        finalCycleId = newCycle.id;
      }
      finalCycleName = job.cycleName;
    }

    let coverPath: string | null = null;
    if (parsed.coverBase64) {
      coverPath = await storeOptimizedCover(Buffer.from(parsed.coverBase64, "base64"), fileHash);
    }

    const [book] = await db.insert(booksTable).values({
      ownerUserId: job.ownerUserId,
      title: parsed.title,
      author: parsed.author,
      description: parsed.description,
      language: parsed.language,
      publicationYear: parsed.publicationYear,
      coverPath,
      format: ext,
      storageKey,
      fileHash,
      fileSize: job.fileSize,
      cycleId: finalCycleId,
      cycleName: finalCycleName,
      cycleNumber: job.cycleNumber ?? null,
    }).returning();

    if (parsed.chapters.length > 0) {
      await db.insert(chaptersTable).values(
        parsed.chapters.map((ch) => ({
          bookId: book.id,
          index: ch.index,
          title: ch.title,
          htmlContent: ch.htmlContent,
          wordCount: ch.wordCount,
        }))
      );
    }

    if (parsed.genres.length > 0) {
      const allGenres = await db.select().from(genresTable);
      const matchedIds = resolveGenreIds(parsed.genres, allGenres);
      if (matchedIds.length > 0) {
        await db.insert(bookGenresTable).values(matchedIds.map((gId) => ({ bookId: book.id, genreId: gId }))).onConflictDoNothing();
      }
    }

    await updateUploadJob(jobId, { status: "completed", stage: "completed", progress: 100, bookId: book.id, completedAt: new Date() });
    fs.rmSync(tempPath, { force: true });
  } catch (e) {
    await updateUploadJob(jobId, {
      status: "failed",
      stage: "failed",
      progress: 100,
      errorMessage: e instanceof Error ? e.message : "Не удалось распарсить файл",
      completedAt: new Date(),
    });
    fs.rmSync(tempPath, { force: true });
  }
}

// Helper functions for GET /books to reduce cognitive complexity
function buildBookFilters(
  userId: number, 
  search?: string, 
  author?: string, 
  cycleId?: string,
  uploadedAfter?: string,
  uploadedBefore?: string
) {
  const conditions = [eq(booksTable.ownerUserId, userId)];
  
  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(
      sql`(${ilike(booksTable.title, searchPattern)} OR ${ilike(booksTable.author, searchPattern)})`
    );
  }
  
  if (author) conditions.push(ilike(booksTable.author, `%${author}%`));
  if (cycleId) conditions.push(eq(booksTable.cycleId, Number.parseInt(cycleId, 10)));
  if (uploadedAfter) conditions.push(sql`${booksTable.uploadedAt} >= ${new Date(uploadedAfter)}`);
  if (uploadedBefore) conditions.push(sql`${booksTable.uploadedAt} <= ${new Date(uploadedBefore)}`);
  
  return conditions;
}

function determineSortOrder(sortBy: string, sortDir: string) {
  const isDesc = sortDir === "desc";
  
  switch (sortBy) {
    case "title":
      return isDesc ? desc(booksTable.title) : asc(booksTable.title);
    case "author":
      return isDesc ? desc(booksTable.author) : asc(booksTable.author);
    case "publicationYear":
      return isDesc ? desc(booksTable.publicationYear) : asc(booksTable.publicationYear);
    case "uploadedAt":
    default:
      return isDesc ? desc(booksTable.uploadedAt) : asc(booksTable.uploadedAt);
  }
}

async function filterByGenre(books: any[], genreId?: string) {
  if (!genreId) return books;
  
  const gId = Number.parseInt(genreId, 10);
  const bookIds = await db.select({ bookId: bookGenresTable.bookId }).from(bookGenresTable).where(eq(bookGenresTable.genreId, gId));
  const ids = new Set(bookIds.map((r) => r.bookId));
  return books.filter((b) => b && ids.has(b.id));
}

function filterByReadingStatus(books: any[], status?: string) {
  if (!status) return books;
  return books.filter((b) => b?.readingStatus === status || (!b?.readingStatus && status === "not_started"));
}

function filterByReadDate(books: any[], readAfter?: string) {
  if (!readAfter) return books;
  const readAfterDate = new Date(readAfter);
  return books.filter((b) => b?.lastReadAt && new Date(b.lastReadAt) >= readAfterDate);
}

function applyClientSideSort(books: any[], sortBy: string, sortDir: string) {
  const isDesc = sortDir === "desc";
  
  if (sortBy === "progress") {
    books.sort((a, b) => {
      const aVal = a?.progressPercent ?? 0;
      const bVal = b?.progressPercent ?? 0;
      return isDesc ? bVal - aVal : aVal - bVal;
    });
  } else if (sortBy === "lastReadAt") {
    books.sort((a, b) => {
      const aVal = a?.lastReadAt ? new Date(a.lastReadAt).getTime() : 0;
      const bVal = b?.lastReadAt ? new Date(b.lastReadAt).getTime() : 0;
      return isDesc ? bVal - aVal : aVal - bVal;
    });
  }
  
  return books;
}

function groupBooks(books: any[], groupBy?: string) {
  if (!groupBy) return null;
  
  const grouped: Record<string, any[]> = {};
  
  for (const book of books) {
    let key: string;
    
    if (groupBy === "genre") {
      key = book?.genres?.[0]?.name || "Без жанра";
    } else if (groupBy === "author") {
      key = book?.author || "Неизвестный автор";
    } else if (groupBy === "cycle") {
      key = book?.cycleName || "Вне цикла";
    } else {
      continue;
    }
    
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(book);
  }
  
  return { grouped, groupBy };
}

// GET /books - Enhanced library query with flexible filtering, sorting, and grouping
router.get("/books", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const { 
    search, 
    genreId, 
    author, 
    cycleId, 
    status, 
    sortBy = "uploadedAt", 
    sortDir = "desc",
    groupBy,
    uploadedAfter,
    uploadedBefore,
    readAfter,
  } = req.query as Record<string, string>;

  // Build WHERE conditions
  const conditions = buildBookFilters(user.id, search, author, cycleId, uploadedAfter, uploadedBefore);

  // Determine sort order
  const orderByClause = determineSortOrder(sortBy, sortDir);

  // Fetch books from database
  const books = await db
    .select()
    .from(booksTable)
    .where(and(...conditions))
    .orderBy(orderByClause);

  // Enrich with details
  const results = await Promise.all(books.map((b) => getBookWithDetails(b.id, user.id)));
  let filtered = results.filter(Boolean);

  // Apply filters
  filtered = await filterByGenre(filtered, genreId);
  filtered = filterByReadingStatus(filtered, status);
  filtered = filterByReadDate(filtered, readAfter);

  // Apply client-side sorting for computed fields
  filtered = applyClientSideSort(filtered, sortBy, sortDir);

  // Apply grouping if requested
  const groupedResult = groupBooks(filtered, groupBy);
  if (groupedResult) {
    res.json(groupedResult);
    return;
  }

  res.json(filtered);
});

// POST /books/upload
router.post("/books/upload", requireAuth, upload.single("file"), async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  if (!req.file) {
    res.status(400).json({ error: "Файл не загружен" });
    return;
  }

  const ext = path.extname(req.file.originalname).toLowerCase().replace(".", "") as "fb2" | "epub";
  const tempStorageKey = `${crypto.randomUUID()}${path.extname(req.file.originalname).toLowerCase()}`;
  const tempPath = path.join(tempUploadsDir, tempStorageKey);
  fs.writeFileSync(tempPath, req.file.buffer);

  const [job] = await db.insert(bookUploadJobsTable).values({
    ownerUserId: user.id,
    originalFilename: req.file.originalname,
    fileSize: req.file.size,
    format: ext,
    tempStorageKey,
    status: "queued",
    stage: "queued",
    progress: 5,
    cycleId: req.body?.cycleId ? Number.parseInt(req.body.cycleId, 10) : null,
    cycleName: req.body?.cycleName || null,
    cycleNumber: req.body?.cycleNumber ? Number.parseFloat(req.body.cycleNumber) : null,
  }).returning();

  setImmediate(() => {
    processBookUploadJob(job.id).catch((error) => {
      console.error("Background book upload job failed:", error);
    });
  });

  res.status(202).json(toUploadJobResponse(job));
});

router.get("/books/upload-jobs/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const idParam = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number.parseInt(idParam, 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Некорректный id задачи" });
    return;
  }

  const [job] = await db.select().from(bookUploadJobsTable).where(and(eq(bookUploadJobsTable.id, id), eq(bookUploadJobsTable.ownerUserId, user.id)));
  if (!job) {
    res.status(404).json({ error: "Задача загрузки не найдена" });
    return;
  }

  res.json(toUploadJobResponse(job));
});

// GET /books/:id/cover-public (публичный endpoint для популярных книг)
router.get("/books/:id/cover-public", async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const [book] = await db.select().from(booksTable).where(eq(booksTable.id, id));
  if (!book?.coverPath) { res.status(404).json({ error: "Обложка не найдена" }); return; }
  const coverFilePath = resolveUploadPath(book.coverPath);
  if (!fs.existsSync(coverFilePath)) { res.status(404).json({ error: "Файл не найден" }); return; }
  const ext = path.extname(coverFilePath).toLowerCase();
  let mime = "image/jpeg";
  if (ext === ".webp") mime = "image/webp";
  else if (ext === ".png") mime = "image/png";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "public, max-age=86400");
  fs.createReadStream(coverFilePath).pipe(res);
});

// GET /books/:id/cover
router.get("/books/:id/cover", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const id = Number.parseInt(String(req.params.id), 10);
  const [book] = await db.select().from(booksTable).where(and(eq(booksTable.id, id), eq(booksTable.ownerUserId, user.id)));
  if (!book?.coverPath) { res.status(404).json({ error: "Обложка не найдена" }); return; }
  const coverFilePath = resolveUploadPath(book.coverPath);
  if (!fs.existsSync(coverFilePath)) { res.status(404).json({ error: "Файл не найден" }); return; }
  const ext = path.extname(coverFilePath).toLowerCase();
  let mime = "image/jpeg";
  if (ext === ".webp") mime = "image/webp";
  else if (ext === ".png") mime = "image/png";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "private, no-cache");
  fs.createReadStream(coverFilePath).pipe(res);
});

// GET /books/:id
router.get("/books/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const id = Number.parseInt(String(req.params.id), 10);
  const result = await getBookWithDetails(id, user.id);
  if (!result) { res.status(404).json({ error: "Книга не найдена" }); return; }
  if ((await db.select().from(booksTable).where(and(eq(booksTable.id, id), eq(booksTable.ownerUserId, user.id)))).length === 0) {
    res.status(403).json({ error: "Доступ запрещён" });
    return;
  }
  res.json(result);
});

// PATCH /books/:id
router.patch("/books/:id", requireAuth, upload.single("cover"), async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const id = Number.parseInt(String(req.params.id), 10);
  const [book] = await db.select().from(booksTable).where(and(eq(booksTable.id, id), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }

  await applyBookUpdates({ book, body: (req.body ?? {}) as Record<string, unknown>, file: req.file ?? undefined });

  const result = await getBookWithDetails(id, user.id);
  res.json(result);
});

// DELETE /books/:id
router.delete("/books/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const id = Number.parseInt(String(req.params.id), 10);
  const [book] = await db.select().from(booksTable).where(and(eq(booksTable.id, id), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена" }); return; }
  await deleteStoredFilesIfUnreferenced(book);
  await db.delete(booksTable).where(eq(booksTable.id, id));
  res.sendStatus(204);
});

// POST /books/delete-bulk
router.post("/books/delete-bulk", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "Список ID обязателен" });
    return;
  }
  const booksToDelete = await db.select().from(booksTable).where(and(eq(booksTable.ownerUserId, user.id), inArray(booksTable.id, ids)));
  const deletingIds = booksToDelete.map((book) => book.id);
  for (const book of booksToDelete) {
    await deleteStoredFilesIfUnreferenced(book, deletingIds);
  }
  const result = await db.delete(booksTable).where(and(eq(booksTable.ownerUserId, user.id), inArray(booksTable.id, ids))).returning();
  res.json({ deleted: result.length });
});

// GET /public/popular-books
router.get("/public/popular-books", async (req, res): Promise<void> => {
  const limit = Math.min(Number.parseInt(String(req.query.limit ?? "8"), 10), 20);

  const popularBooks = await db
    .select({
      id: booksTable.id,
      title: booksTable.title,
      author: booksTable.author,
      description: booksTable.description,
      coverPath: booksTable.coverPath,
      openCount: sql<number>`count(${readEventsTable.id})::int`,
    })
    .from(booksTable)
    .leftJoin(readEventsTable, eq(readEventsTable.bookId, booksTable.id))
    .where(eq(booksTable.status, "active"))
    .groupBy(booksTable.id)
    .orderBy(desc(sql`count(${readEventsTable.id})`))
    .limit(limit);

  res.json(popularBooks.map((b) => ({
    id: b.id,
    title: b.title,
    author: b.author ?? null,
    description: b.description ? b.description.slice(0, 200) : null,
    coverUrl: b.coverPath ? buildCoverUrl(b.id, b.coverPath, true) : null,
    openCount: b.openCount ?? 0,
  })));
});

export default router;
