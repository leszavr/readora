import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { asc, eq } from "drizzle-orm";
import { db, landingBooksTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";
import { optimizeImage } from "../lib/image-optimizer";
import { parseBook } from "../lib/parser";
import { ensureStorageDirs, resolveUploadPath } from "../lib/storage";
import { invalidatePopularBooksCache } from "../lib/popular-books-service";

const router = Router();

ensureStorageDirs();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 2 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === "bookFile") {
      callback(null, extension === ".fb2" || extension === ".epub");
      return;
    }

    if (file.fieldname === "cover") {
      callback(null, file.mimetype.startsWith("image/") || [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(extension));
      return;
    }

    callback(new Error("Неподдерживаемый тип файла"));
  },
});

function normalizeText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeDescription(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 1_000) : null;
}

function parseSortOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : undefined;
}

function parsePublished(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

function formatLandingBook(book: typeof landingBooksTable.$inferSelect) {
  return {
    id: book.id,
    title: book.title,
    author: book.author,
    description: book.description,
    coverUrl: `/api/admin/landing-books/${book.id}/cover?v=${book.updatedAt.getTime()}`,
    sortOrder: book.sortOrder,
    isPublished: book.isPublished,
    createdAt: book.createdAt,
    updatedAt: book.updatedAt,
  };
}

async function storeLandingCover(buffer: Buffer): Promise<string> {
  const optimized = await optimizeImage(buffer, "cover");
  const hash = crypto.createHash("sha256").update(optimized.buffer).digest("hex");
  const storageKey = `covers/landing-${hash}.webp`;
  fs.writeFileSync(resolveUploadPath(storageKey), optimized.buffer);
  return storageKey;
}

async function deleteLandingCoverIfUnreferenced(coverPath: string): Promise<void> {
  const references = await db
    .select({ id: landingBooksTable.id })
    .from(landingBooksTable)
    .where(eq(landingBooksTable.coverPath, coverPath));
  if (references.length > 0) return;

  fs.rmSync(resolveUploadPath(coverPath), { force: true });
}

function getUploadedFile(files: Express.Multer.File[] | Record<string, Express.Multer.File[]> | undefined, name: string): Express.Multer.File | undefined {
  if (!files || Array.isArray(files)) return undefined;
  return files[name]?.[0];
}

router.get("/admin/landing-books", requireAdmin, async (_req, res): Promise<void> => {
  const books = await db.select().from(landingBooksTable).orderBy(asc(landingBooksTable.sortOrder), asc(landingBooksTable.id));
  res.json(books.map(formatLandingBook));
});

router.post(
  "/admin/landing-books",
  requireAdmin,
  upload.fields([{ name: "bookFile", maxCount: 1 }, { name: "cover", maxCount: 1 }]),
  async (req, res): Promise<void> => {
    const bookFile = getUploadedFile(req.files, "bookFile");
    const cover = getUploadedFile(req.files, "cover");
    if (!bookFile || !cover) {
      res.status(400).json({ error: "Загрузите файл книги и готовую обложку" });
      return;
    }

    const extension = path.extname(bookFile.originalname).slice(1).toLowerCase();
    if (extension !== "fb2" && extension !== "epub") {
      res.status(400).json({ error: "Поддерживаются только FB2 и EPUB файлы" });
      return;
    }

    const parsed = parseBook(bookFile.buffer, extension);
    const coverPath = await storeLandingCover(cover.buffer);
    const [book] = await db
      .insert(landingBooksTable)
      .values({
        title: parsed.title.slice(0, 320),
        author: normalizeText(parsed.author, 320),
        description: normalizeDescription(parsed.description),
        coverPath,
      })
      .returning();

    res.status(201).json(formatLandingBook(book));
  },
);

router.patch("/admin/landing-books/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id <= 0) {
    res.status(400).json({ error: "Некорректный идентификатор книги" });
    return;
  }

  const title = normalizeText(req.body?.title, 320);
  const author = normalizeText(req.body?.author, 320);
  const description = normalizeText(req.body?.description, 1_000);
  const sortOrder = parseSortOrder(req.body?.sortOrder);
  const isPublished = parsePublished(req.body?.isPublished);

  if (req.body?.title !== undefined && !title) {
    res.status(400).json({ error: "Название книги обязательно" });
    return;
  }
  if (req.body?.sortOrder !== undefined && sortOrder === undefined) {
    res.status(400).json({ error: "Порядок должен быть целым числом от 0 до 10000" });
    return;
  }

  const updates: Partial<typeof landingBooksTable.$inferInsert> = {};
  if (title !== undefined && title !== null) updates.title = title;
  if (author !== undefined) updates.author = author;
  if (description !== undefined) updates.description = description;
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (isPublished !== undefined) updates.isPublished = isPublished;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "Нет данных для обновления" });
    return;
  }

  const [book] = await db.update(landingBooksTable).set(updates).where(eq(landingBooksTable.id, id)).returning();
  if (!book) {
    res.status(404).json({ error: "Книга лендинга не найдена" });
    return;
  }

  invalidatePopularBooksCache();
  res.json(formatLandingBook(book));
});

router.post("/admin/landing-books/:id/cover", requireAdmin, upload.single("cover"), async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id) || id <= 0 || !req.file) {
    res.status(400).json({ error: "Загрузите корректную обложку" });
    return;
  }

  const [existing] = await db.select().from(landingBooksTable).where(eq(landingBooksTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Книга лендинга не найдена" });
    return;
  }

  const coverPath = await storeLandingCover(req.file.buffer);
  const [book] = await db.update(landingBooksTable).set({ coverPath }).where(eq(landingBooksTable.id, id)).returning();
  await deleteLandingCoverIfUnreferenced(existing.coverPath);
  invalidatePopularBooksCache();
  res.json(formatLandingBook(book));
});

router.delete("/admin/landing-books/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const [book] = await db.delete(landingBooksTable).where(eq(landingBooksTable.id, id)).returning();
  if (!book) {
    res.status(404).json({ error: "Книга лендинга не найдена" });
    return;
  }

  await deleteLandingCoverIfUnreferenced(book.coverPath);
  invalidatePopularBooksCache();
  res.sendStatus(204);
});

router.get("/admin/landing-books/:id/cover", requireAdmin, async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const [book] = await db.select().from(landingBooksTable).where(eq(landingBooksTable.id, id));
  if (!book) {
    res.sendStatus(404);
    return;
  }

  const filePath = resolveUploadPath(book.coverPath);
  if (!fs.existsSync(filePath)) {
    res.sendStatus(404);
    return;
  }

  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "private, no-cache");
  fs.createReadStream(filePath).pipe(res);
});

router.get("/public/landing-book-covers/:id", async (req, res): Promise<void> => {
  const id = Number.parseInt(String(req.params.id), 10);
  const [book] = await db
    .select()
    .from(landingBooksTable)
    .where(eq(landingBooksTable.id, id));
  if (!book?.isPublished) {
    res.sendStatus(404);
    return;
  }

  const filePath = resolveUploadPath(book.coverPath);
  if (!fs.existsSync(filePath)) {
    res.sendStatus(404);
    return;
  }

  res.setHeader("Content-Type", "image/webp");
  res.setHeader("Cache-Control", "public, max-age=3600");
  fs.createReadStream(filePath).pipe(res);
});

export default router;
