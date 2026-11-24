import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Response } from "express";
import { and, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import { booksTable, db, readingHistoryTable } from "@workspace/db";
import { optimizeImage } from "./image-optimizer";
import { logger } from "./logger";
import { resolveUploadPath } from "./storage";

export async function storeOptimizedCover(inputBuffer: Buffer, filePrefix: string): Promise<string> {
  const optimized = await optimizeImage(inputBuffer, "cover");
  const coverHash = crypto.createHash("sha256").update(optimized.buffer).digest("hex");
  const coverStorageKey = `covers/${filePrefix}-${coverHash}.webp`;
  fs.writeFileSync(resolveUploadPath(coverStorageKey), optimized.buffer);
  return coverStorageKey;
}

async function countCoverReferences(coverPath: string, excludingBookIds: number[]): Promise<number> {
  const bookConditions = [eq(booksTable.coverPath, coverPath)];
  if (excludingBookIds.length > 0) bookConditions.push(notInArray(booksTable.id, excludingBookIds));

  const [bookRefs, historyRefs] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(booksTable).where(and(...bookConditions)),
    db.select({ count: sql<number>`count(*)::int` })
      .from(readingHistoryTable)
      .where(eq(readingHistoryTable.coverPath, coverPath)),
  ]);

  return bookRefs[0].count + historyRefs[0].count;
}

export async function deleteCoverIfUnreferenced(coverPath: string, excludingBookIds: number[] = []): Promise<void> {
  if ((await countCoverReferences(coverPath, excludingBookIds)) === 0) {
    fs.rmSync(resolveUploadPath(coverPath), { force: true });
  }
}

export async function collectUserHistoryCoverPaths(userId: number): Promise<string[]> {
  const rows = await db
    .selectDistinct({ coverPath: readingHistoryTable.coverPath })
    .from(readingHistoryTable)
    .where(and(eq(readingHistoryTable.userId, userId), isNotNull(readingHistoryTable.coverPath)));
  return rows.flatMap((row) => (row.coverPath ? [row.coverPath] : []));
}

export async function deleteUnreferencedHistoryCovers(coverPaths: readonly string[]): Promise<void> {
  for (const coverPath of coverPaths) {
    try {
      await deleteCoverIfUnreferenced(coverPath);
    } catch {
      logger.error({ coverPath }, "Failed to delete a reading history cover file");
    }
  }
}

export function sendStoredCover(res: Response, coverPath: string): boolean {
  const coverFilePath = resolveUploadPath(coverPath);
  if (!fs.existsSync(coverFilePath)) return false;

  const ext = path.extname(coverFilePath).toLowerCase();
  let mime = "image/jpeg";
  if (ext === ".webp") mime = "image/webp";
  else if (ext === ".png") mime = "image/png";
  res.setHeader("Content-Type", mime);
  res.setHeader("Cache-Control", "private, no-cache");
  fs.createReadStream(coverFilePath).pipe(res);
  return true;
}
