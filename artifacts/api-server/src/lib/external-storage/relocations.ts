import { and, eq } from "drizzle-orm";
import {
  booksTable,
  db,
  externalBookRelocationsTable,
  externalStorageConnectionsTable,
  type ExternalBookRelocation,
} from "@workspace/db";
import { externalStorageKey } from "./sync";
import { deleteStoredFilesIfUnreferenced } from "../book-deletion-service";
import { hasGiftCopiesOutside, GIFT_SOURCE_IN_USE_MESSAGE } from "../gift-editions-service";

// Переезд локальной книги в облако: синхронизация нашла файл с тем же
// fileHash. Книга остаётся той же записью (прогресс, закладки и заметки не
// трогаются) — ей проставляются внешние поля, локальный файл удаляется.

export type RelocationResolveAction = "migrate" | "dismiss";

export function isValidRelocationAction(value: unknown): value is RelocationResolveAction {
  return value === "migrate" || value === "dismiss";
}

export async function listPendingRelocations(userId: number, connectionId: number) {
  return db
    .select({
      id: externalBookRelocationsTable.id,
      bookId: externalBookRelocationsTable.bookId,
      bookTitle: booksTable.title,
      bookAuthor: booksTable.author,
      fileName: externalBookRelocationsTable.fileName,
      externalPath: externalBookRelocationsTable.externalPath,
      fileSize: externalBookRelocationsTable.fileSize,
      createdAt: externalBookRelocationsTable.createdAt,
    })
    .from(externalBookRelocationsTable)
    .innerJoin(booksTable, eq(booksTable.id, externalBookRelocationsTable.bookId))
    .where(
      and(
        eq(externalBookRelocationsTable.ownerUserId, userId),
        eq(externalBookRelocationsTable.connectionId, connectionId),
        eq(externalBookRelocationsTable.status, "pending"),
      ),
    )
    .orderBy(externalBookRelocationsTable.id);
}

export async function resolveExternalRelocation(
  relocationId: number,
  ownerUserId: number,
  action: RelocationResolveAction,
): Promise<{ ok: true; relocation: ExternalBookRelocation } | { ok: false; status: number; error: string }> {
  const [relocation] = await db
    .select()
    .from(externalBookRelocationsTable)
    .where(
      and(eq(externalBookRelocationsTable.id, relocationId), eq(externalBookRelocationsTable.ownerUserId, ownerUserId)),
    );
  if (!relocation) return { ok: false, status: 404, error: "Кандидат на переезд не найден" };
  if (relocation.status !== "pending") return { ok: false, status: 409, error: "Кандидат уже обработан" };

  if (action === "dismiss") {
    const [updated] = await db
      .update(externalBookRelocationsTable)
      .set({ status: "dismissed", resolvedAt: new Date() })
      .where(eq(externalBookRelocationsTable.id, relocation.id))
      .returning();
    return { ok: true, relocation: updated };
  }

  const [connection] = await db
    .select()
    .from(externalStorageConnectionsTable)
    .where(eq(externalStorageConnectionsTable.id, relocation.connectionId));
  if (!connection) return { ok: false, status: 404, error: "Подключение не найдено" };

  const [book] = await db
    .select()
    .from(booksTable)
    .where(and(eq(booksTable.id, relocation.bookId), eq(booksTable.ownerUserId, ownerUserId)));
  if (!book) return { ok: false, status: 404, error: "Книга не найдена" };
  if (book.externalConnectionId !== null || book.externalProvider !== null) {
    return { ok: false, status: 409, error: "Книга уже привязана к внешнему хранилищу" };
  }
  if (await hasGiftCopiesOutside([book.id])) {
    return { ok: false, status: 409, error: GIFT_SOURCE_IN_USE_MESSAGE };
  }

  const [occupied] = await db
    .select({ id: booksTable.id })
    .from(booksTable)
    .where(
      and(
        eq(booksTable.externalConnectionId, connection.id),
        eq(booksTable.externalPath, relocation.externalPath),
      ),
    );
  if (occupied && occupied.id !== book.id) {
    return { ok: false, status: 409, error: "Файл в облаке уже привязан к другой книге" };
  }

  let updated: ExternalBookRelocation | undefined;
  try {
    updated = await db.transaction(async (tx) => {
      // Захват под транзакцией: повторный запрос не обработает кандидата дважды.
      const [claimed] = await tx
        .update(externalBookRelocationsTable)
        .set({ status: "migrated", resolvedAt: new Date() })
        .where(
          and(eq(externalBookRelocationsTable.id, relocation.id), eq(externalBookRelocationsTable.status, "pending")),
        )
        .returning();
      if (!claimed) throw new Error("Кандидат уже обработан");

      await tx
        .update(booksTable)
        .set({
          externalConnectionId: connection.id,
          externalProvider: connection.provider,
          externalPath: relocation.externalPath,
          externalEtag: relocation.etag,
          externalModifiedAt: null,
          externalMissing: false,
          storageKey: externalStorageKey(connection.id, relocation.externalPath),
          fileSize: relocation.fileSize,
        })
        .where(eq(booksTable.id, book.id));
      return claimed;
    });
  } catch (e) {
    return { ok: false, status: 409, error: e instanceof Error ? e.message : "Не удалось перенести книгу" };
  }

  // Локальный файл удаляется после коммита: книга уже внешняя, файл не нужен.
  // Обложка остаётся у книги, gift-копии с тем же файлом сохранят его.
  await deleteStoredFilesIfUnreferenced(book, []).catch(() => undefined);

  return { ok: true, relocation: updated };
}
