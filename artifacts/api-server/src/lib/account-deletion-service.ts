import fs from "node:fs";
import path from "node:path";
import { and, eq, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  booksTable,
  bookUploadJobsTable,
  userSessionsTable,
  accountDeletionLogTable,
} from "@workspace/db";
import type { User } from "@workspace/db";
import { emailService } from "./email-service";
import { deleteStoredFilesIfUnreferenced } from "./book-deletion-service";
import { userOwnsGiftSourcesInUse } from "./gift-editions-service";
import { resolveUploadPath } from "./storage";
import { logger } from "./logger";

const DAY_MS = 24 * 60 * 60 * 1000;

// Grace period (модель GitHub): аккаунт окончательно очищается через N дней,
// восстановление до этой даты — через администрацию.
export const DELETION_GRACE_DAYS = 30;

export type AccountDeletionActor = "user" | "admin" | "system";

export interface ScheduledDeletionResult {
  scheduledFor: Date;
  alreadyScheduled: boolean;
}

/** Аккаунт помечен на удаление (используется и для блокировки входа). */
export function isDeletionScheduled(user: Pick<User, "scheduledDeletionAt">): boolean {
  return user.scheduledDeletionAt !== null;
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * DAY_MS);
}

function formatDeletionDate(date: Date): string {
  return date.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

async function logDeletionAction(
  userId: number,
  action: "scheduled" | "restored" | "purged",
  actor: AccountDeletionActor,
  scheduledFor?: Date | null,
): Promise<void> {
  await db.insert(accountDeletionLogTable).values({
    userId,
    action,
    actor,
    scheduledFor: scheduledFor ?? null,
  });
}

async function destroyUserSessions(userId: number): Promise<void> {
  await db
    .delete(userSessionsTable)
    .where(sql`${userSessionsTable.sess}->>'userId' = ${String(userId)}`);
  const { revokeAllUserRememberTokens } = await import("./remember-token-service");
  await revokeAllUserRememberTokens(userId);
}

async function sendDeletionScheduledEmail(user: User, scheduledFor: Date): Promise<void> {
  if (!emailService.isEnabled()) return;
  try {
    const baseUrl = process.env.APP_ORIGIN || "http://localhost:3000";
    await emailService.sendAccountDeletionScheduled(
      user.email,
      user.username,
      formatDeletionDate(scheduledFor),
      DELETION_GRACE_DAYS,
      baseUrl,
    );
  } catch (error) {
    logger.error({ userId: user.id, error }, "Failed to send account deletion scheduled email");
  }
}

/**
 * Помечает аккаунт на удаление через grace period. Идемпотентна: повторный
 * вызов для уже помеченного аккаунта не сбрасывает таймер. Условный UPDATE
 * (`scheduled_deletion_at IS NULL`) исключает гонку с параллельным вызовом.
 * Все сессии и «запомнить меня»-токены аннулируются: вход для помеченного
 * аккаунта блокируется, восстановление — только через администрацию.
 */
export async function scheduleAccountDeletion(
  user: User,
  actor: AccountDeletionActor,
): Promise<ScheduledDeletionResult> {
  if (user.scheduledDeletionAt) {
    return { scheduledFor: user.scheduledDeletionAt, alreadyScheduled: true };
  }

  const scheduledFor = daysFromNow(DELETION_GRACE_DAYS);
  const [updated] = await db
    .update(usersTable)
    .set({ scheduledDeletionAt: scheduledFor })
    .where(and(eq(usersTable.id, user.id), isNull(usersTable.scheduledDeletionAt)))
    .returning();

  if (!updated) {
    // Параллельный вызов успел первым — возвращаем его расписание.
    const [existing] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    if (existing?.scheduledDeletionAt) {
      return { scheduledFor: existing.scheduledDeletionAt, alreadyScheduled: true };
    }
    throw new Error("Failed to schedule account deletion");
  }

  await logDeletionAction(user.id, "scheduled", actor, scheduledFor);
  await destroyUserSessions(user.id);
  await sendDeletionScheduledEmail(updated, scheduledFor);

  logger.info({ userId: user.id, actor, scheduledFor: scheduledFor.toISOString() }, "Account deletion scheduled");
  return { scheduledFor, alreadyScheduled: false };
}

/**
 * Восстанавливает аккаунт, помеченный на удаление (только администрация).
 * Возвращает обновлённого пользователя или null, если аккаунт не помечен
 * (гонка с планировщиком решается условным UPDATE).
 */
export async function restoreAccountDeletion(userId: number): Promise<User | null> {
  const [updated] = await db
    .update(usersTable)
    .set({ scheduledDeletionAt: null })
    .where(and(eq(usersTable.id, userId), isNotNull(usersTable.scheduledDeletionAt)))
    .returning();

  if (!updated) return null;

  await logDeletionAction(userId, "restored", "admin");
  logger.info({ userId }, "Account deletion restored by admin");
  return updated;
}

export type PurgeResult = "purged" | "not_found" | "not_scheduled" | "gift_sources_in_use";

/**
 * Фактическая очистка аккаунта: транзакция БД (каскад по FK) сначала, файлы
 * после коммита — упавший процесс оставит только осиротевшие файлы, которые
 * доберёт повторный прогон; обратный порядок оставил бы записи без файлов.
 *
 * strictScheduled=true требует, чтобы аккаунт был помечен на удаление
 * (административное «удалить окончательно» помеченного аккаунта).
 */
export async function purgeUserAccount(
  userId: number,
  actor: AccountDeletionActor,
  options: { strictScheduled?: boolean } = {},
): Promise<PurgeResult> {
  const [user] = await db
    .select({ id: usersTable.id, scheduledDeletionAt: usersTable.scheduledDeletionAt })
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user) return "not_found";
  if (options.strictScheduled && !user.scheduledDeletionAt) return "not_scheduled";
  if (await userOwnsGiftSourcesInUse(userId)) return "gift_sources_in_use";

  const [books, uploadJobs] = await Promise.all([
    db.select().from(booksTable).where(eq(booksTable.ownerUserId, userId)),
    db.select().from(bookUploadJobsTable).where(eq(bookUploadJobsTable.ownerUserId, userId)),
  ]);

  const deleteCondition = options.strictScheduled
    ? and(eq(usersTable.id, userId), isNotNull(usersTable.scheduledDeletionAt))
    : eq(usersTable.id, userId);

  let purged = false;
  await db.transaction(async (tx) => {
    // Условный DELETE + возвращённые строки: гонка с параллельным
    // восстановлением или повторным прогоном оставит транзакцию пустой.
    const rows = await tx.delete(usersTable).where(deleteCondition).returning({ id: usersTable.id });
    if (rows.length === 0) return;
    purged = true;
    await tx.insert(accountDeletionLogTable).values({
      userId,
      action: "purged",
      actor,
      scheduledFor: user.scheduledDeletionAt ?? null,
    });
    await tx
      .delete(userSessionsTable)
      .where(sql`${userSessionsTable.sess}->>'userId' = ${String(userId)}`);
  });

  if (!purged) {
    const [existing] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, userId));
    return existing ? "not_scheduled" : "not_found";
  }

  for (const book of books) {
    try {
      await deleteStoredFilesIfUnreferenced(book);
    } catch {
      logger.error({ bookId: book.id }, "Failed to delete an account book file");
    }
  }

  for (const job of uploadJobs) {
    try {
      fs.rmSync(resolveUploadPath(path.join("tmp", job.tempStorageKey)), { force: true });
    } catch {
      logger.error({ jobId: job.id }, "Failed to delete an account temporary upload");
    }
  }

  logger.info({ userId, actor }, "Account purged");
  return "purged";
}

export interface ScheduledDeletionProcessingResult {
  accountsPurged: number;
  accountsSkipped: number;
}

/** Очередь очистки для планировщика: только просроченные помеченные аккаунты. */
export async function processScheduledAccountDeletions(): Promise<ScheduledDeletionProcessingResult> {
  const due = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(and(isNotNull(usersTable.scheduledDeletionAt), lte(usersTable.scheduledDeletionAt, new Date())))
    .limit(100);

  let accountsPurged = 0;
  let accountsSkipped = 0;
  for (const { id } of due) {
    const result = await purgeUserAccount(id, "system").catch((error): PurgeResult => {
      logger.error({ userId: id, error }, "Failed to purge a scheduled account deletion");
      return "not_found";
    });

    if (result === "purged") accountsPurged += 1;
    else if (result === "gift_sources_in_use") accountsSkipped += 1;
  }

  if (accountsPurged > 0 || accountsSkipped > 0) {
    logger.info({ accountsPurged, accountsSkipped }, "Scheduled account deletions processed");
  }

  return { accountsPurged, accountsSkipped };
}
