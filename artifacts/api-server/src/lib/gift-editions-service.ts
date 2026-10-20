import { and, asc, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import { bookGenresTable, booksTable, catalogEditionsTable, catalogGiftOffersTable, db } from "@workspace/db";
import { logger } from "./logger";

type StoredBook = typeof booksTable.$inferSelect;

/** Книга, из которой берутся главы: для подарочной копии — каноническая, иначе сама книга. */
export function getContentBookId(book: Pick<StoredBook, "id" | "contentBookId">): number {
  return book.contentBookId ?? book.id;
}

async function selectMissingEditions(userId: number, onlyAutoGrantOnSignup = false) {
  const now = new Date();
  const owned = db
    .select({ id: booksTable.contentBookId })
    .from(booksTable)
    .where(and(eq(booksTable.ownerUserId, userId), sql`${booksTable.contentBookId} is not null`));

  return db
    .select({ book: booksTable })
    .from(catalogGiftOffersTable)
    .innerJoin(catalogEditionsTable, eq(catalogGiftOffersTable.catalogEditionId, catalogEditionsTable.id))
    .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
    .where(and(
      eq(catalogGiftOffersTable.isPublished, true),
      eq(catalogEditionsTable.status, "published"),
      eq(booksTable.status, "active"),
      eq(booksTable.scope, "catalog_source"),
      isNull(booksTable.contentBookId),
      notInArray(booksTable.id, owned),
      or(isNull(catalogGiftOffersTable.availableFrom), sql`${catalogGiftOffersTable.availableFrom} <= ${now}`),
      or(isNull(catalogGiftOffersTable.availableUntil), sql`${catalogGiftOffersTable.availableUntil} > ${now}`),
      onlyAutoGrantOnSignup ? eq(catalogGiftOffersTable.autoGrantOnSignup, true) : undefined,
    ))
    .orderBy(asc(catalogGiftOffersTable.sortOrder), asc(catalogGiftOffersTable.id));
}

export async function countAvailableGiftEditions(userId: number): Promise<number> {
  return (await selectMissingEditions(userId)).length;
}

/** Добавляет пользователю недостающие опубликованные подарочные издания. Возвращает число добавленных книг. */
async function grantBooks(userId: number, editions: { book: StoredBook }[]): Promise<number> {
  if (editions.length === 0) return 0;

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(booksTable)
      .values(editions.map(({ book }) => ({
        ownerUserId: userId,
        title: book.title,
        author: book.author,
        description: book.description,
        coverPath: book.coverPath,
        format: book.format,
        language: book.language,
        publicationYear: book.publicationYear,
        storageKey: book.storageKey,
        fileHash: book.fileHash,
        fileSize: book.fileSize,
        contentBookId: book.id,
      })))
      .onConflictDoNothing()
      .returning({ id: booksTable.id, contentBookId: booksTable.contentBookId });

    const sourceIds = inserted.map((row) => row.contentBookId).filter((id): id is number => id !== null);
    if (sourceIds.length > 0) {
      const genres = await tx
        .select()
        .from(bookGenresTable)
        .where(inArray(bookGenresTable.bookId, sourceIds));
      const copyIdBySource = new Map(inserted.map((row) => [row.contentBookId, row.id]));
      const genreRows = genres.flatMap((genre) => {
        const bookId = copyIdBySource.get(genre.bookId);
        return bookId ? [{ bookId, genreId: genre.genreId }] : [];
      });
      if (genreRows.length > 0) {
        await tx.insert(bookGenresTable).values(genreRows).onConflictDoNothing();
      }
    }

    return inserted.length;
  });
}

/** Добавляет пользователю недостающие опубликованные подарочные издания. */
export async function grantGiftEditions(userId: number): Promise<number> {
  return grantBooks(userId, await selectMissingEditions(userId));
}

/** Добавляет в библиотеку конкретное опубликованное каталожное издание. */
export async function claimCatalogEdition(userId: number, catalogEditionId: number): Promise<number> {
  const [edition] = await db
    .select({ book: booksTable })
    .from(catalogEditionsTable)
    .innerJoin(booksTable, eq(catalogEditionsTable.sourceBookId, booksTable.id))
    .where(and(
      eq(catalogEditionsTable.id, catalogEditionId),
      eq(catalogEditionsTable.status, "published"),
      eq(booksTable.scope, "catalog_source"),
      eq(booksTable.status, "active"),
    ));
  if (!edition) return 0;

  return grantBooks(userId, [edition]);
}

/** Безопасная выдача при создании аккаунта: ошибка не должна ломать регистрацию. */
export async function grantGiftEditionsOnSignup(userId: number): Promise<void> {
  try {
    await grantBooks(userId, await selectMissingEditions(userId, true));
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to grant gift editions");
  }
}
