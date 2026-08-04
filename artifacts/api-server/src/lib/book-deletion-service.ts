import fs from "node:fs";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { db, booksTable } from "@workspace/db";
import { resolveUploadPath } from "./storage";

type StoredBook = typeof booksTable.$inferSelect;

export function normalizeBookIds(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 500) return null;

  const ids = [...new Set(value)];
  return ids.every((id) => Number.isSafeInteger(id) && id > 0) ? ids : null;
}

export async function deleteStoredFilesIfUnreferenced(
  book: StoredBook,
  excludingBookIds: number[] = [book.id],
): Promise<void> {
  const [{ count: sameFileCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(booksTable)
    .where(and(eq(booksTable.storageKey, book.storageKey), notInArray(booksTable.id, excludingBookIds)));
  if (sameFileCount === 0) {
    fs.rmSync(resolveUploadPath(book.storageKey), { force: true });
  }

  if (!book.coverPath) return;

  const [{ count: sameCoverCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(booksTable)
    .where(and(eq(booksTable.coverPath, book.coverPath), notInArray(booksTable.id, excludingBookIds)));
  if (sameCoverCount === 0) {
    fs.rmSync(resolveUploadPath(book.coverPath), { force: true });
  }
}
