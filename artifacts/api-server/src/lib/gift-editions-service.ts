import { and, asc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { db, bookGenresTable, booksTable, chaptersTable, giftEditionsTable } from "@workspace/db";
import { logger } from "./logger";

type StoredBook = typeof booksTable.$inferSelect;

export const GIFT_SOURCE_IN_USE_MESSAGE =
  "Книга используется как подарочное издание в библиотеках пользователей. Снимите её с публикации в разделе «Подарочные издания» вместо удаления.";

/** Книга, из которой берутся главы: для подарочной копии — каноническая, иначе сама книга. */
export function getContentBookId(book: Pick<StoredBook, "id" | "contentBookId">): number {
  return book.contentBookId ?? book.id;
}

async function selectMissingEditions(userId: number) {
  const owned = db
    .select({ id: booksTable.contentBookId })
    .from(booksTable)
    .where(and(eq(booksTable.ownerUserId, userId), sql`${booksTable.contentBookId} is not null`));

  return db
    .select({ book: booksTable })
    .from(giftEditionsTable)
    .innerJoin(booksTable, eq(giftEditionsTable.bookId, booksTable.id))
    .where(and(
      eq(giftEditionsTable.isPublished, true),
      eq(booksTable.status, "active"),
      isNull(booksTable.contentBookId),
      sql`${booksTable.ownerUserId} <> ${userId}`,
      notInArray(booksTable.id, owned),
    ))
    .orderBy(asc(giftEditionsTable.sortOrder), asc(giftEditionsTable.id));
}

export async function countAvailableGiftEditions(userId: number): Promise<number> {
  return (await selectMissingEditions(userId)).length;
}

/** Добавляет пользователю недостающие опубликованные подарочные издания. Возвращает число добавленных книг. */
export async function grantGiftEditions(userId: number): Promise<number> {
  const editions = await selectMissingEditions(userId);
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

/** Безопасная выдача при создании аккаунта: ошибка не должна ломать регистрацию. */
export async function grantGiftEditionsOnSignup(userId: number): Promise<void> {
  try {
    await grantGiftEditions(userId);
  } catch (error) {
    logger.error({ err: error, userId }, "Failed to grant gift editions");
  }
}

/** Возвращает true, если среди удаляемых книг есть канонические, на которые ссылаются копии вне удаляемого набора. */
export async function hasGiftCopiesOutside(bookIds: number[]): Promise<boolean> {
  if (bookIds.length === 0) return false;
  const [row] = await db
    .select({ id: booksTable.id })
    .from(booksTable)
    .where(and(inArray(booksTable.contentBookId, bookIds), notInArray(booksTable.id, bookIds)))
    .limit(1);
  return Boolean(row);
}

/** То же для всех книг пользователя (перед удалением аккаунта). */
export async function userOwnsGiftSourcesInUse(userId: number): Promise<boolean> {
  const owned = db.select({ id: booksTable.id }).from(booksTable).where(eq(booksTable.ownerUserId, userId));
  const [row] = await db
    .select({ id: booksTable.id })
    .from(booksTable)
    .where(and(inArray(booksTable.contentBookId, owned), sql`${booksTable.ownerUserId} <> ${userId}`))
    .limit(1);
  return Boolean(row);
}

/**
 * Эталон подарочного издания всегда принадлежит администратору: книгу другого пользователя
 * клонируем в библиотеку администратора (файл и обложка общие, главы копируются один раз),
 * чтобы владелец мог свободно удалить свою книгу.
 */
export async function resolveGiftSourceBook(book: StoredBook, adminUserId: number): Promise<StoredBook> {
  if (book.ownerUserId === adminUserId) return book;

  if (book.fileHash) {
    const [existing] = await db
      .select()
      .from(booksTable)
      .where(and(
        eq(booksTable.ownerUserId, adminUserId),
        eq(booksTable.fileHash, book.fileHash),
        isNull(booksTable.contentBookId),
      ))
      .limit(1);
    if (existing) return existing;
  }

  return db.transaction(async (tx) => {
    const [clone] = await tx
      .insert(booksTable)
      .values({
        ownerUserId: adminUserId,
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
        hideFromPopular: true,
      })
      .returning();

    await tx.execute(sql`
      insert into ${chaptersTable} (book_id, "index", title, html_content, word_count)
      select ${clone.id}, "index", title, html_content, word_count from ${chaptersTable} where book_id = ${book.id}
    `);
    await tx.execute(sql`
      insert into ${bookGenresTable} (book_id, genre_id)
      select ${clone.id}, genre_id from ${bookGenresTable} where book_id = ${book.id}
      on conflict do nothing
    `);
    return clone;
  });
}
