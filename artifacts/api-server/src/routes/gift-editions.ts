import { Router, type Request } from "express";
import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db, booksTable, giftEditionsTable, type usersTable } from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/auth";
import { countAvailableGiftEditions, grantGiftEditions } from "../lib/gift-editions-service";

const router = Router();
type AuthReq = Request & { user: typeof usersTable.$inferSelect };

function parseId(value: unknown): number | null {
  const id = Number.parseInt(String(value), 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseSortOrder(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10_000 ? parsed : Number.NaN;
}

function coverUrl(bookId: number, coverPath: string | null): string | null {
  return coverPath ? `/api/books/${bookId}/cover?v=${encodeURIComponent(coverPath)}` : null;
}

async function listEditions() {
  const copiesCount = sql<number>`(select count(*)::int from ${booksTable} as copies where copies.content_book_id = ${booksTable.id})`;
  const rows = await db
    .select({ edition: giftEditionsTable, book: booksTable, copiesCount })
    .from(giftEditionsTable)
    .innerJoin(booksTable, eq(giftEditionsTable.bookId, booksTable.id))
    .orderBy(asc(giftEditionsTable.sortOrder), asc(giftEditionsTable.id));

  return rows.map(({ edition, book, copiesCount }) => ({
    id: edition.id,
    bookId: book.id,
    title: book.title,
    author: book.author ?? null,
    format: book.format,
    coverUrl: coverUrl(book.id, book.coverPath),
    ownerUserId: book.ownerUserId,
    sortOrder: edition.sortOrder,
    isPublished: edition.isPublished,
    copiesCount,
    createdAt: edition.createdAt,
  }));
}

// --- Пользователь ---

router.get("/gift-editions/available", requireAuth, async (req, res): Promise<void> => {
  res.json({ availableCount: await countAvailableGiftEditions((req as AuthReq).user.id) });
});

router.post("/gift-editions/claim", requireAuth, async (req, res): Promise<void> => {
  res.json({ added: await grantGiftEditions((req as AuthReq).user.id) });
});

// --- Администратор ---

router.get("/admin/gift-editions", requireAdmin, async (_req, res): Promise<void> => {
  res.json(await listEditions());
});

// Кандидаты — только собственные книги администратора, чтобы не раздавать чужие приватные загрузки.
router.get("/admin/gift-editions/candidates", requireAdmin, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const editionBookIds = db.select({ id: giftEditionsTable.bookId }).from(giftEditionsTable);
  const books = await db
    .select({ id: booksTable.id, title: booksTable.title, author: booksTable.author, format: booksTable.format })
    .from(booksTable)
    .where(and(
      eq(booksTable.ownerUserId, user.id),
      eq(booksTable.status, "active"),
      isNull(booksTable.contentBookId),
      notInArray(booksTable.id, editionBookIds),
    ))
    .orderBy(asc(booksTable.title));
  res.json(books.map((book) => ({ ...book, author: book.author ?? null })));
});

router.post("/admin/gift-editions", requireAdmin, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const bookId = parseId(req.body?.bookId);
  const sortOrder = parseSortOrder(req.body?.sortOrder);
  if (!bookId) { res.status(400).json({ error: "Выберите книгу" }); return; }
  if (Number.isNaN(sortOrder)) { res.status(400).json({ error: "Порядок должен быть целым числом от 0 до 10000" }); return; }

  const [book] = await db
    .select()
    .from(booksTable)
    .where(and(eq(booksTable.id, bookId), eq(booksTable.ownerUserId, user.id)));
  if (!book) { res.status(404).json({ error: "Книга не найдена в вашей библиотеке" }); return; }
  if (book.contentBookId !== null) { res.status(400).json({ error: "Подарочную копию нельзя сделать подарочным изданием" }); return; }
  if (book.status !== "active") { res.status(400).json({ error: "Заблокированную книгу нельзя сделать подарочным изданием" }); return; }

  const [edition] = await db
    .insert(giftEditionsTable)
    .values({ bookId, sortOrder: sortOrder ?? 0, isPublished: req.body?.isPublished !== false })
    .onConflictDoNothing()
    .returning();
  if (!edition) { res.status(409).json({ error: "Книга уже добавлена в подарочные издания" }); return; }

  res.status(201).json((await listEditions()).find((item) => item.id === edition.id));
});

router.patch("/admin/gift-editions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Некорректный идентификатор" }); return; }

  const updates: Partial<typeof giftEditionsTable.$inferInsert> = {};
  const sortOrder = parseSortOrder(req.body?.sortOrder);
  if (Number.isNaN(sortOrder)) { res.status(400).json({ error: "Порядок должен быть целым числом от 0 до 10000" }); return; }
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (typeof req.body?.isPublished === "boolean") updates.isPublished = req.body.isPublished;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Нет данных для обновления" }); return; }

  const [edition] = await db.update(giftEditionsTable).set(updates).where(eq(giftEditionsTable.id, id)).returning();
  if (!edition) { res.status(404).json({ error: "Подарочное издание не найдено" }); return; }

  res.json((await listEditions()).find((item) => item.id === edition.id));
});

// Убирает книгу из списка выдачи. Уже выданные копии и каноническая книга остаются.
router.delete("/admin/gift-editions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Некорректный идентификатор" }); return; }
  const [edition] = await db.delete(giftEditionsTable).where(eq(giftEditionsTable.id, id)).returning();
  if (!edition) { res.status(404).json({ error: "Подарочное издание не найдено" }); return; }
  res.sendStatus(204);
});

export default router;
