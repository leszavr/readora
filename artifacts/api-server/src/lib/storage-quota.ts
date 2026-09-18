import { and, eq, inArray, sql } from "drizzle-orm";
import {
  appSettingsTable,
  bookUploadJobsTable,
  booksTable,
  db,
  readingProgressTable,
  usersTable,
} from "@workspace/db";

const BYTES_PER_MB = 1024 * 1024;
const MAX_BOOK_FILE_SIZE_MB = 500;
const MAX_LIBRARY_STORAGE_MB = 100 * 1024;
export const DEFAULT_MAX_BOOK_FILE_SIZE_MB = 50;
export const DEFAULT_LIBRARY_STORAGE_MB = 1024;

const QUOTA_SETTING_KEYS = ["maxFileSizeMb", "libraryStorageLimitMb"] as const;

type UserForQuota = Pick<typeof usersTable.$inferSelect, "id" | "role">;
type NewUploadJob = typeof bookUploadJobsTable.$inferInsert;

export type StorageQuota = {
  isExempt: boolean;
  maxFileSizeBytes: number | null;
  storageLimitBytes: number | null;
  usedBytes: number;
  reservedBytes: number;
  availableBytes: number | null;
  canUpload: boolean;
  shelfBooksCount: number;
};

export class UploadLimitError extends Error {
  constructor(
    readonly code: "FILE_SIZE_LIMIT" | "STORAGE_QUOTA_EXCEEDED",
    message: string,
  ) {
    super(message);
  }
}

function parseLimit(value: string | null | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum ? parsed : fallback;
}

function getLimits(settings: Record<string, string | null>) {
  const maxFileSizeMb = parseLimit(
    settings.maxFileSizeMb,
    DEFAULT_MAX_BOOK_FILE_SIZE_MB,
    MAX_BOOK_FILE_SIZE_MB,
  );
  const libraryStorageLimitMb = Math.max(
    maxFileSizeMb,
    parseLimit(settings.libraryStorageLimitMb, DEFAULT_LIBRARY_STORAGE_MB, MAX_LIBRARY_STORAGE_MB),
  );

  return {
    maxFileSizeBytes: maxFileSizeMb * BYTES_PER_MB,
    storageLimitBytes: libraryStorageLimitMb * BYTES_PER_MB,
  };
}

function toNumber(value: number | string | null | undefined): number {
  return Number(value ?? 0);
}

async function getSettings(): Promise<Record<string, string | null>> {
  const rows = await db
    .select({ key: appSettingsTable.key, value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(inArray(appSettingsTable.key, [...QUOTA_SETTING_KEYS]));

  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function getUsage(userId: number) {
  const [booksRows, jobsRows, shelfRows] = await Promise.all([
    db
      .select({ usedBytes: sql<number>`coalesce(sum(${booksTable.fileSize}), 0)::double precision` })
      .from(booksTable)
      .where(eq(booksTable.ownerUserId, userId)),
    db
      .select({ reservedBytes: sql<number>`coalesce(sum(${bookUploadJobsTable.fileSize}), 0)::double precision` })
      .from(bookUploadJobsTable)
      .where(and(
        eq(bookUploadJobsTable.ownerUserId, userId),
        inArray(bookUploadJobsTable.status, ["queued", "processing"]),
      )),
    db
      .select({ shelfBooksCount: sql<number>`count(distinct ${readingProgressTable.bookId})::int` })
      .from(readingProgressTable)
      .where(and(
        eq(readingProgressTable.userId, userId),
        eq(readingProgressTable.readingStatus, "finished"),
      )),
  ]);

  return {
    usedBytes: toNumber(booksRows[0]?.usedBytes),
    reservedBytes: toNumber(jobsRows[0]?.reservedBytes),
    shelfBooksCount: toNumber(shelfRows[0]?.shelfBooksCount),
  };
}

export async function getStorageQuota(user: UserForQuota): Promise<StorageQuota> {
  const usage = await getUsage(user.id);
  if (user.role === "admin") {
    return {
      isExempt: true,
      maxFileSizeBytes: null,
      storageLimitBytes: null,
      usedBytes: usage.usedBytes,
      reservedBytes: usage.reservedBytes,
      availableBytes: null,
      canUpload: true,
      shelfBooksCount: usage.shelfBooksCount,
    };
  }

  const limits = getLimits(await getSettings());
  const availableBytes = Math.max(0, limits.storageLimitBytes - usage.usedBytes - usage.reservedBytes);
  return {
    isExempt: false,
    ...limits,
    ...usage,
    availableBytes,
    canUpload: availableBytes > 0,
  };
}

export async function createUploadJobWithinQuota(
  user: UserForQuota,
  input: NewUploadJob & { fileSize: number },
): Promise<typeof bookUploadJobsTable.$inferSelect> {
  return db.transaction(async (tx) => {
    if (user.role !== "admin") {
      await tx.execute(sql`select pg_advisory_xact_lock(${user.id})`);

      const [settingsRows, booksRows, jobsRows] = await Promise.all([
        tx
          .select({ key: appSettingsTable.key, value: appSettingsTable.value })
          .from(appSettingsTable)
          .where(inArray(appSettingsTable.key, [...QUOTA_SETTING_KEYS])),
        tx
          .select({ usedBytes: sql<number>`coalesce(sum(${booksTable.fileSize}), 0)::double precision` })
          .from(booksTable)
          .where(eq(booksTable.ownerUserId, user.id)),
        tx
          .select({ reservedBytes: sql<number>`coalesce(sum(${bookUploadJobsTable.fileSize}), 0)::double precision` })
          .from(bookUploadJobsTable)
          .where(and(
            eq(bookUploadJobsTable.ownerUserId, user.id),
            inArray(bookUploadJobsTable.status, ["queued", "processing"]),
          )),
      ]);
      const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
      const limits = getLimits(settings);
      const usedBytes = toNumber(booksRows[0]?.usedBytes);
      const reservedBytes = toNumber(jobsRows[0]?.reservedBytes);

      if (input.fileSize > limits.maxFileSizeBytes) {
        throw new UploadLimitError(
          "FILE_SIZE_LIMIT",
          `Размер книги превышает лимит ${Math.round(limits.maxFileSizeBytes / BYTES_PER_MB)} МБ`,
        );
      }
      if (usedBytes + reservedBytes + input.fileSize > limits.storageLimitBytes) {
        throw new UploadLimitError(
          "STORAGE_QUOTA_EXCEEDED",
          "Недостаточно свободного места в библиотеке. Удалите ненужные книги и повторите загрузку.",
        );
      }
    }

    const [job] = await tx.insert(bookUploadJobsTable).values(input).returning();
    return job;
  });
}

export function validateQuotaSetting(value: unknown, maximum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= maximum
    ? value
    : null;
}

export const quotaSettingBounds = {
  maxBookFileSizeMb: MAX_BOOK_FILE_SIZE_MB,
  libraryStorageMb: MAX_LIBRARY_STORAGE_MB,
};
