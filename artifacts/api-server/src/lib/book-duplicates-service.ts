import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, booksTable, chaptersTable, notesTable, bookmarksTable, readingProgressTable, usersTable } from "@workspace/db";
import { deleteStoredFilesIfUnreferenced } from "./book-deletion-service";

// Дубликат: тот же владелец + тот же fileHash, две и более записи
// (подарочные копии с content_book_id не считаются самостоятельными книгами).

export interface DuplicateCandidateInfo {
  id: number;
  title: string;
  author: string | null;
  uploadedAt: Date;
  hasProgress: boolean;
  progressPercent: number | null;
  readingStatus: string | null;
  lastReadAt: Date | null;
  bookmarkCount: number;
  noteCount: number;
}

export interface DuplicateGroup {
  ownerId: number;
  ownerUsername: string | null;
  fileHash: string;
  title: string;
  author: string | null;
  candidates: DuplicateCandidateInfo[];
  keepId: number;
}

function scoreCandidate(c: DuplicateCandidateInfo): number {
  // «Актуальность» книги: активный прогресс важнее всего, затем закладки/заметки,
  // затем давность чтения; при полном равенстве выигрывает раннее создание.
  let score = 0;
  if (c.hasProgress) score += 100;
  if (c.progressPercent !== null) score += c.progressPercent;
  if (c.readingStatus === "finished") score += 10;
  if (c.readingStatus === "reading") score += 20;
  score += c.bookmarkCount * 5 + c.noteCount * 5;
  if (c.lastReadAt) score += Math.min(50, c.lastReadAt.getTime() / (1000 * 60 * 60 * 24 * 365));
  return score;
}

export async function findDuplicateGroups(): Promise<DuplicateGroup[]> {
  const rows = await db
    .select({
      ownerId: booksTable.ownerUserId,
      ownerUsername: usersTable.username,
      fileHash: booksTable.fileHash,
      bookId: booksTable.id,
      title: booksTable.title,
      author: booksTable.author,
      uploadedAt: booksTable.uploadedAt,
    })
    .from(booksTable)
    .leftJoin(usersTable, eq(usersTable.id, booksTable.ownerUserId))
    .where(and(
      isNull(booksTable.contentBookId),
      sql`${booksTable.fileHash} in (
        select file_hash from ${booksTable}
        where file_hash is not null and content_book_id is null
        group by owner_user_id, file_hash having count(*) > 1
      ) and ${booksTable.ownerUserId} || '/' || ${booksTable.fileHash} in (
        select owner_user_id || '/' || file_hash from ${booksTable}
        where file_hash is not null and content_book_id is null
        group by owner_user_id, file_hash having count(*) > 1
      )`,
    ))
    .orderBy(asc(booksTable.ownerUserId), asc(booksTable.uploadedAt));

  if (rows.length === 0) return [];

  const bookIds = rows.map((r) => r.bookId);
  const [progressRows, bookmarkRows, noteRows] = await Promise.all([
    db
      .select({
        bookId: readingProgressTable.bookId,
        progressPercent: readingProgressTable.progressPercent,
        readingStatus: readingProgressTable.readingStatus,
        lastReadAt: readingProgressTable.lastReadAt,
      })
      .from(readingProgressTable)
      .where(inArray(readingProgressTable.bookId, bookIds)),
    db
      .select({ bookId: bookmarksTable.bookId, count: sql<number>`count(*)::int` })
      .from(bookmarksTable)
      .where(inArray(bookmarksTable.bookId, bookIds))
      .groupBy(bookmarksTable.bookId),
    db
      .select({ bookId: notesTable.bookId, count: sql<number>`count(*)::int` })
      .from(notesTable)
      .where(inArray(notesTable.bookId, bookIds))
      .groupBy(notesTable.bookId),
  ]);

  const progressByBook = new Map(progressRows.map((p) => [p.bookId, p]));
  const bookmarksByBook = new Map(bookmarkRows.map((b) => [b.bookId, b.count]));
  const notesByBook = new Map(noteRows.map((n) => [n.bookId, n.count]));

  const groupsMap = new Map<string, DuplicateGroup>();
  for (const row of rows) {
    const key = `${row.ownerId}/${row.fileHash}`;
    const progress = progressByBook.get(row.bookId);
    const candidate: DuplicateCandidateInfo = {
      id: row.bookId,
      title: row.title,
      author: row.author,
      uploadedAt: row.uploadedAt,
      hasProgress: progress !== undefined,
      progressPercent: progress?.progressPercent ?? null,
      readingStatus: progress?.readingStatus ?? null,
      lastReadAt: progress?.lastReadAt ?? null,
      bookmarkCount: bookmarksByBook.get(row.bookId) ?? 0,
      noteCount: notesByBook.get(row.bookId) ?? 0,
    };
    const existingGroup = groupsMap.get(key);
    const group: DuplicateGroup = existingGroup ?? {
      ownerId: row.ownerId,
      ownerUsername: row.ownerUsername,
      fileHash: row.fileHash as string,
      title: row.title,
      author: row.author,
      candidates: [],
      keepId: row.bookId,
    };
    if (!existingGroup) groupsMap.set(key, group);
    group.candidates.push(candidate);
    const bestOtherScore = Math.max(...group.candidates.filter((c) => c.id !== candidate.id).map(scoreCandidate), -Infinity);
    if (scoreCandidate(candidate) > bestOtherScore) {
      group.keepId = candidate.id;
    }
  }

  return [...groupsMap.values()];
}

export interface DeduplicateResult {
  keptBookId: number;
  removedBookIds: number[];
}

// Слияние группы дублей: переносит прогресс/закладки/заметки на keepId
// и удаляет остальные записи. Вызывается в транзакции.
export async function mergeDuplicateBooks(
  keepId: number,
  removeIds: number[],
  tx: Pick<typeof db, "select" | "update" | "delete" | "insert"> = db,
): Promise<DeduplicateResult> {
  const [keep] = await tx.select().from(booksTable).where(eq(booksTable.id, keepId));
  if (!keep) throw new Error(`Книга ${keepId} не найдена`);

  const removing = await tx.select().from(booksTable).where(inArray(booksTable.id, removeIds));
  if (removing.length !== removeIds.length) throw new Error("Часть книг для удаления не найдена");

  for (const dup of removing) {
    if (dup.ownerUserId !== keep.ownerUserId) {
      throw new Error("Нельзя объединять книги разных владельцев");
    }
    if (dup.fileHash !== keep.fileHash) {
      throw new Error("Книги имеют разные файлы");
    }
    if (dup.contentBookId !== null) {
      throw new Error("Подарочные копии не участвуют в слиянии");
    }
  }

  const keepChapters = await tx
    .select({ id: chaptersTable.id, index: chaptersTable.index })
    .from(chaptersTable)
    .where(eq(chaptersTable.bookId, keepId));

  // Главы идентичного файла совпадают по индексу — через карту ремапим chapterId.
  for (const dup of removing) {
    const dupChapters = await tx
      .select({ id: chaptersTable.id, index: chaptersTable.index })
      .from(chaptersTable)
      .where(eq(chaptersTable.bookId, dup.id));
    const chapterIdMap = new Map<number, number>();
    for (const ch of dupChapters) {
      const target = keepChapters.find((k) => k.index === ch.index);
      if (target) chapterIdMap.set(ch.id, target.id);
    }

    // Прогресс: PK (userId, bookId). Если у keep уже есть — не трогаем (keep актуальнее).
    await tx
      .update(readingProgressTable)
      .set({ bookId: keepId })
      .where(and(
        eq(readingProgressTable.bookId, dup.id),
        // Не создаём конфликт PK, если у keep прогресс уже есть
        sql`not exists (
          select 1 from ${readingProgressTable} rp
          where rp.user_id = ${readingProgressTable.userId} and rp.book_id = ${keepId}
        )`,
      ));

    // Закладки без конфликта PK — просто переносим с ремапом глав.
    const dupBookmarks = await tx.select().from(bookmarksTable).where(eq(bookmarksTable.bookId, dup.id));
    if (dupBookmarks.length > 0) {
      await tx.delete(bookmarksTable).where(eq(bookmarksTable.bookId, dup.id));
      await tx.insert(bookmarksTable).values(
        dupBookmarks
          .map((bm) => ({
            id: bm.id,
            userId: bm.userId,
            bookId: keepId,
            chapterId: chapterIdMap.get(bm.chapterId) ?? keepChapters[0]?.id ?? bm.chapterId,
            positionRaw: bm.positionRaw,
            label: bm.label,
            selectedText: bm.selectedText,
            createdAt: bm.createdAt,
          })),
      );
    }

    // Заметки — аналогично, uuid PK не конфликтует.
    const dupNotes = await tx.select().from(notesTable).where(eq(notesTable.bookId, dup.id));
    if (dupNotes.length > 0) {
      await tx.delete(notesTable).where(eq(notesTable.bookId, dup.id));
      await tx.insert(notesTable).values(
        dupNotes.map((n) => ({
          id: n.id,
          userId: n.userId,
          bookId: keepId,
          chapterId: chapterIdMap.get(n.chapterId) ?? keepChapters[0]?.id ?? n.chapterId,
          positionRaw: n.positionRaw,
          highlightedText: n.highlightedText,
          noteText: n.noteText,
          color: n.color,
          createdAt: n.createdAt,
          updatedAt: n.updatedAt,
        })),
      );
    }
  }

  // Подарочные копии (content_book_id) ссылаются на удаляемые книги restrict-FK —
  // файл идентичен, поэтому перенацеливаем их на сохраняемую запись.
  await tx
    .update(booksTable)
    .set({ contentBookId: keepId })
    .where(inArray(booksTable.contentBookId, removeIds));

  // Файлы и обложка общие; исключаем из проверки ссылок только удаляемые книги —
  // keep продолжает ссылаться на файл, поэтому он останется на диске.
  // Главы/жанры/события дублей удалятся каскадом вместе с записями книг.
  await tx.delete(booksTable).where(inArray(booksTable.id, removeIds));
  for (const dup of removing) {
    await deleteStoredFilesIfUnreferenced(dup, removeIds);
  }

  return { keptBookId: keepId, removedBookIds: removeIds };
}
