import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, isNull, lte, notExists, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  booksTable,
  bookUploadJobsTable,
  userSessionsTable,
  emailVerificationTokensTable,
  unverifiedAccountCleanupLogTable,
} from "@workspace/db";
import { emailService } from "./email-service";
import { deleteStoredFilesIfUnreferenced } from "./book-deletion-service";
import { resolveUploadPath } from "./storage";
import { logger } from "./logger";

const REMINDER_AFTER_DAYS = 30;
const DELETE_REMINDER_AGE_DAYS = 10;
const REMINDER_TOKEN_TTL_DAYS = 10;

export interface UnverifiedAccountsProcessingResult {
  remindersSent: number;
  accountsDeleted: number;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// Только аккаунты, зарегистрированные по email: у OAuth-пользователей email
// подтверждён при создании. Никогда не входившие (lastLoginAt is null) —
// чтобы не затронуть пользователей, успевших войти в период отключённого SMTP.
const unverifiedEmailAccounts = and(
  eq(usersTable.emailVerified, false),
  isNull(usersTable.externalProvider),
  isNull(usersTable.lastLoginAt),
  eq(usersTable.role, "user"),
);

async function sendVerificationReminders(): Promise<number> {
  if (!emailService.isEnabled()) return 0;

  const candidates = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
      username: usersTable.username,
    })
    .from(usersTable)
    .where(and(
      unverifiedEmailAccounts,
      lte(usersTable.createdAt, daysAgo(REMINDER_AFTER_DAYS)),
      notExists(
        db
          .select({ one: sql`1` })
          .from(unverifiedAccountCleanupLogTable)
          .where(and(
            eq(unverifiedAccountCleanupLogTable.userId, usersTable.id),
            eq(unverifiedAccountCleanupLogTable.action, "reminder_sent"),
          )),
      ),
    ))
    .limit(200);

  let sent = 0;
  for (const user of candidates) {
    try {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + REMINDER_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

      await db.transaction(async (tx) => {
        await tx
          .delete(emailVerificationTokensTable)
          .where(eq(emailVerificationTokensTable.userId, user.id));
        await tx.insert(emailVerificationTokensTable).values({
          userId: user.id,
          token,
          expiresAt,
        });
      });

      const baseUrl = process.env.APP_ORIGIN || "http://localhost:3000";
      const delivered = await emailService.sendEmailVerificationReminder(
        user.email,
        user.username,
        token,
        baseUrl,
      );
      if (!delivered) continue;

      await db.insert(unverifiedAccountCleanupLogTable).values({
        userId: user.id,
        action: "reminder_sent",
      });
      sent += 1;
    } catch (error) {
      logger.error({ userId: user.id, error }, "Failed to send unverified account reminder");
    }
  }

  return sent;
}

async function deleteUnverifiedAccounts(): Promise<number> {
  const candidates = await db
    .select({
      id: usersTable.id,
      email: usersTable.email,
    })
    .from(usersTable)
    .where(and(
      unverifiedEmailAccounts,
      sql`exists (
        select 1 from ${unverifiedAccountCleanupLogTable}
        where ${unverifiedAccountCleanupLogTable.userId} = ${usersTable.id}
          and ${unverifiedAccountCleanupLogTable.action} = 'reminder_sent'
          and ${unverifiedAccountCleanupLogTable.createdAt} <= ${daysAgo(DELETE_REMINDER_AGE_DAYS)}
      )`,
    ))
    .limit(100);

  let deleted = 0;
  for (const user of candidates) {
    try {
      const [books, uploadJobs] = await Promise.all([
        db.select().from(booksTable).where(eq(booksTable.ownerUserId, user.id)),
        db.select().from(bookUploadJobsTable).where(eq(bookUploadJobsTable.ownerUserId, user.id)),
      ]);

      await db.transaction(async (tx) => {
        await tx.insert(unverifiedAccountCleanupLogTable).values({
          userId: user.id,
          action: "account_deleted",
        });
        await tx
          .delete(userSessionsTable)
          .where(sql`${userSessionsTable.sess}->>'userId' = ${String(user.id)}`);
        await tx.delete(usersTable).where(eq(usersTable.id, user.id));
      });

      for (const book of books) {
        try {
          await deleteStoredFilesIfUnreferenced(book);
        } catch {
          logger.error({ bookId: book.id }, "Failed to delete an unverified account book file");
        }
      }

      for (const job of uploadJobs) {
        try {
          fs.rmSync(resolveUploadPath(path.join("tmp", job.tempStorageKey)), { force: true });
        } catch {
          logger.error({ jobId: job.id }, "Failed to delete an unverified account temporary upload");
        }
      }

      deleted += 1;
    } catch (error) {
      logger.error({ userId: user.id, error }, "Failed to delete an unverified account");
    }
  }

  return deleted;
}

export async function processUnverifiedAccounts(): Promise<UnverifiedAccountsProcessingResult> {
  const remindersSent = await sendVerificationReminders();
  const accountsDeleted = await deleteUnverifiedAccounts();

  if (remindersSent > 0 || accountsDeleted > 0) {
    logger.info({ remindersSent, accountsDeleted }, "Unverified accounts cleanup completed");
  }

  return { remindersSent, accountsDeleted };
}
