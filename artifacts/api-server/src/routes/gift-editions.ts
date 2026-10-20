import { Router, type Request } from "express";
import { and, asc, eq, sql } from "drizzle-orm";
import { booksTable, catalogEditionsTable, catalogGiftOffersTable, db, type usersTable } from "@workspace/db";
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

function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function coverUrl(catalogEditionId: number, coverPath: string | null): string | null {
  return coverPath ? `/api/catalog/editions/${catalogEditionId}/cover?v=${encodeURIComponent(coverPath)}` : null;
}

async function listEditions() {
  const copiesCount = sql<number>`(select count(*)::int from ${booksTable} as copies where copies.content_book_id = ${booksTable.id})`;
  const rows = await db
    .select({ offer: catalogGiftOffersTable, catalogEdition: catalogEditionsTable, book: booksTable, copiesCount })
    .from(catalogGiftOffersTable)
    .innerJoin(catalogEditionsTable, eq(catalogGiftOffersTable.catalogEditionId, catalogEditionsTable.id))
    .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
    .orderBy(asc(catalogGiftOffersTable.sortOrder), asc(catalogGiftOffersTable.id));

  return rows.map(({ offer, catalogEdition, book, copiesCount }) => ({
    id: offer.id,
    catalogEditionId: catalogEdition.id,
    bookId: book.id,
    title: book.title,
    author: book.author ?? null,
    format: book.format,
    coverUrl: coverUrl(catalogEdition.id, book.coverPath),
    sortOrder: offer.sortOrder,
    isPublished: offer.isPublished,
    availableFrom: offer.availableFrom,
    availableUntil: offer.availableUntil,
    autoGrantOnSignup: offer.autoGrantOnSignup,
    copiesCount,
    createdAt: offer.createdAt,
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

router.post("/admin/gift-editions", requireAdmin, async (req, res): Promise<void> => {
  const catalogEditionId = parseId(req.body?.catalogEditionId);
  const bookId = parseId(req.body?.bookId);
  const sortOrder = parseSortOrder(req.body?.sortOrder);
  const availableFrom = parseOptionalDate(req.body?.availableFrom);
  const availableUntil = parseOptionalDate(req.body?.availableUntil);
  if (!catalogEditionId && !bookId) { res.status(400).json({ error: "Выберите каталожное издание" }); return; }
  if (Number.isNaN(sortOrder)) { res.status(400).json({ error: "Порядок должен быть целым числом от 0 до 10000" }); return; }
  if (req.body?.availableFrom !== undefined && availableFrom === undefined || req.body?.availableUntil !== undefined && availableUntil === undefined) {
    res.status(400).json({ error: "Некорректный период выдачи" });
    return;
  }
  if (availableFrom && availableUntil && availableUntil <= availableFrom) {
    res.status(400).json({ error: "Дата окончания должна быть позже даты начала" });
    return;
  }

  const [catalogEdition] = await db
    .select({ id: catalogEditionsTable.id })
    .from(catalogEditionsTable)
    .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
    .where(and(
      eq(booksTable.scope, "catalog_source"),
      catalogEditionId ? eq(catalogEditionsTable.id, catalogEditionId) : eq(catalogEditionsTable.sourceBookId, bookId!),
    ));
  if (!catalogEdition) { res.status(404).json({ error: "Каталожное издание не найдено" }); return; }

  const [edition] = await db
    .insert(catalogGiftOffersTable)
    .values({
      catalogEditionId: catalogEdition.id,
      sortOrder: sortOrder ?? 0,
      isPublished: req.body?.isPublished !== false,
      availableFrom: availableFrom ?? null,
      availableUntil: availableUntil ?? null,
      autoGrantOnSignup: req.body?.autoGrantOnSignup !== false,
    })
    .onConflictDoNothing()
    .returning();
  if (!edition) { res.status(409).json({ error: "Книга уже добавлена в подарочные издания" }); return; }

  res.status(201).json((await listEditions()).find((item) => item.id === edition.id));
});

router.patch("/admin/gift-editions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Некорректный идентификатор" }); return; }

  const updates: Partial<typeof catalogGiftOffersTable.$inferInsert> = {};
  const sortOrder = parseSortOrder(req.body?.sortOrder);
  const availableFrom = parseOptionalDate(req.body?.availableFrom);
  const availableUntil = parseOptionalDate(req.body?.availableUntil);
  if (Number.isNaN(sortOrder)) { res.status(400).json({ error: "Порядок должен быть целым числом от 0 до 10000" }); return; }
  if (req.body?.availableFrom !== undefined && availableFrom === undefined || req.body?.availableUntil !== undefined && availableUntil === undefined) {
    res.status(400).json({ error: "Некорректный период выдачи" });
    return;
  }
  if (sortOrder !== undefined) updates.sortOrder = sortOrder;
  if (typeof req.body?.isPublished === "boolean") updates.isPublished = req.body.isPublished;
  if (req.body?.availableFrom !== undefined) updates.availableFrom = availableFrom ?? null;
  if (req.body?.availableUntil !== undefined) updates.availableUntil = availableUntil ?? null;
  if (typeof req.body?.autoGrantOnSignup === "boolean") updates.autoGrantOnSignup = req.body.autoGrantOnSignup;
  if (Object.keys(updates).length === 0) { res.status(400).json({ error: "Нет данных для обновления" }); return; }

  const [current] = await db.select().from(catalogGiftOffersTable).where(eq(catalogGiftOffersTable.id, id));
  if (!current) { res.status(404).json({ error: "Подарочное издание не найдено" }); return; }
  const effectiveFrom = updates.availableFrom === undefined ? current.availableFrom : updates.availableFrom;
  const effectiveUntil = updates.availableUntil === undefined ? current.availableUntil : updates.availableUntil;
  if (effectiveFrom && effectiveUntil && effectiveUntil <= effectiveFrom) {
    res.status(400).json({ error: "Дата окончания должна быть позже даты начала" });
    return;
  }

  const [edition] = await db.update(catalogGiftOffersTable).set(updates).where(eq(catalogGiftOffersTable.id, id)).returning();
  if (!edition) { res.status(404).json({ error: "Подарочное издание не найдено" }); return; }

  res.json((await listEditions()).find((item) => item.id === edition.id));
});

// Убирает книгу из списка выдачи. Уже выданные копии и каноническая книга остаются.
router.delete("/admin/gift-editions/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) { res.status(400).json({ error: "Некорректный идентификатор" }); return; }
  const [edition] = await db.delete(catalogGiftOffersTable).where(eq(catalogGiftOffersTable.id, id)).returning();
  if (!edition) { res.status(404).json({ error: "Подарочное издание не найдено" }); return; }
  res.sendStatus(204);
});

export default router;
