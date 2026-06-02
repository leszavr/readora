import fs from "fs";
import path from "path";

const DEFAULT_UPLOADS_DIR = path.resolve(process.cwd(), "../../uploads");
// Гарантированно доступный на запись каталог внутри образа (owner nodejs).
const FALLBACK_UPLOADS_DIR = path.resolve(process.cwd(), "uploads");

function isWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// Выбираем рабочий каталог один раз при инициализации модуля.
// Если основной путь недоступен на запись (например, root-owned путь под
// non-root пользователем), откатываемся на FALLBACK, не роняя процесс.
function resolveUploadsDir(): string {
  const preferred = path.resolve(process.env.UPLOADS_DIR || DEFAULT_UPLOADS_DIR);
  if (isWritableDir(preferred)) return preferred;
  if (preferred !== FALLBACK_UPLOADS_DIR) {
    console.warn(
      `[storage] uploads dir "${preferred}" is not writable, falling back to "${FALLBACK_UPLOADS_DIR}"`,
    );
  }
  return FALLBACK_UPLOADS_DIR;
}

export const uploadsDir = resolveUploadsDir();
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
