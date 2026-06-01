import fs from "fs";
import path from "path";

const DEFAULT_UPLOADS_DIR = path.resolve(process.cwd(), "../../uploads");

export const uploadsDir = path.resolve(process.env.UPLOADS_DIR || DEFAULT_UPLOADS_DIR);
export const coversDir = path.join(uploadsDir, "covers");
export const tempUploadsDir = path.join(uploadsDir, "tmp");

export function ensureStorageDirs(): void {
  fs.mkdirSync(uploadsDir, { recursive: true });
  fs.mkdirSync(coversDir, { recursive: true });
  fs.mkdirSync(tempUploadsDir, { recursive: true });
}

export function resolveUploadPath(storageKey: string): string {
  const resolved = path.resolve(uploadsDir, storageKey);
  if (resolved !== uploadsDir && !resolved.startsWith(`${uploadsDir}${path.sep}`)) {
    throw new Error("Invalid storage key");
  }
  return resolved;
}
