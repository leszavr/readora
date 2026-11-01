import crypto from "node:crypto";
import fs from "node:fs";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { booksTable, db } from "@workspace/db";
import { optimizeImage } from "./image-optimizer";
import { resolveUploadPath } from "./storage";

export async function storeOptimizedCover(inputBuffer: Buffer, filePrefix: string): Promise<string> {
  const optimized = await optimizeImage(inputBuffer, "cover");
  const coverHash = crypto.createHash("sha256").update(optimized.buffer).digest("hex");
  const coverStorageKey = `covers/${filePrefix}-${coverHash}.webp`;
  fs.writeFileSync(resolveUploadPath(coverStorageKey), optimized.buffer);
  return coverStorageKey;
}

export async function deleteCoverIfUnreferenced(coverPath: string, excludingBookIds: number[]): Promise<void> {
  const [{ count: sameCoverCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(booksTable)
    .where(and(eq(booksTable.coverPath, coverPath), notInArray(booksTable.id, excludingBookIds)));
  if (sameCoverCount === 0) {
    fs.rmSync(resolveUploadPath(coverPath), { force: true });
  }
}
