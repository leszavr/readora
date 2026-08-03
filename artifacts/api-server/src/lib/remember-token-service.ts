import crypto from "node:crypto";
import { db, rememberTokensTable, usersTable } from "@workspace/db";
import { eq, and, gt, lt } from "drizzle-orm";
import type { Request } from "express";

const REMEMBER_TOKEN_LENGTH = 64; // 64 байта = 512 бит энтропии
const REMEMBER_TOKEN_EXPIRY_DAYS = 90; // 90 дней для долгосрочного хранения

/**
 * Генерирует криптографически стойкий токен и его хеш
 */
function generateRememberToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(REMEMBER_TOKEN_LENGTH).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

/**
 * Извлекает информацию об устройстве из запроса
 */
function getDeviceInfo(req: Request): string {
  const ua = req.headers["user-agent"] || "Unknown";
  // Упрощенное определение типа устройства
  if (ua.includes("Mobile")) return "Mobile Device";
  if (ua.includes("Tablet")) return "Tablet";
  if (ua.includes("Windows")) return "Windows PC";
  if (ua.includes("Mac")) return "Mac";
  if (ua.includes("Linux")) return "Linux PC";
  return "Unknown Device";
}

/**
 * Получает IP-адрес клиента (с учетом прокси)
 */
function getClientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || null;
}

/**
 * Создает новый remember token для пользователя
 */
export async function createRememberToken(
  userId: number,
  req: Request,
): Promise<string> {
  const { token, hash } = generateRememberToken();
  const expiresAt = new Date(
    Date.now() + REMEMBER_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
  );

  await db.insert(rememberTokensTable).values({
    userId,
    tokenHash: hash,
    deviceInfo: getDeviceInfo(req),
    ipAddress: getClientIp(req),
    expiresAt,
  });

  return token; // Возвращаем сам токен (НЕ хеш) для установки в cookie
}

/**
 * Проверяет и возвращает userId по remember token
 * Обновляет lastUsedAt при успешной проверке
 */
export async function validateRememberToken(
  token: string,
): Promise<number | null> {
  const hash = crypto.createHash("sha256").update(token).digest("hex");

  const [rememberToken] = await db
    .select()
    .from(rememberTokensTable)
    .where(
      and(
        eq(rememberTokensTable.tokenHash, hash),
        gt(rememberTokensTable.expiresAt, new Date()),
      ),
    );

  if (!rememberToken) return null;

  // Проверяем, что пользователь не заблокирован
  const [user] = await db
    .select({ id: usersTable.id, status: usersTable.status })
    .from(usersTable)
    .where(eq(usersTable.id, rememberToken.userId));

  if (!user || user.status === "blocked") {
    // Удаляем токен заблокированного пользователя
    await db
      .delete(rememberTokensTable)
      .where(eq(rememberTokensTable.id, rememberToken.id));
    return null;
  }

  // Обновляем время последнего использования
  await db
    .update(rememberTokensTable)
    .set({ lastUsedAt: new Date() })
    .where(eq(rememberTokensTable.id, rememberToken.id));

  return rememberToken.userId;
}

/**
 * Удаляет конкретный remember token
 */
export async function revokeRememberToken(tokenId: number): Promise<boolean> {
  const result = await db
    .delete(rememberTokensTable)
    .where(eq(rememberTokensTable.id, tokenId))
    .returning({ id: rememberTokensTable.id });

  return result.length > 0;
}

/**
 * Удаляет все remember tokens пользователя
 */
export async function revokeAllUserRememberTokens(
  userId: number,
): Promise<number> {
  const result = await db
    .delete(rememberTokensTable)
    .where(eq(rememberTokensTable.userId, userId))
    .returning({ id: rememberTokensTable.id });

  return result.length;
}

/**
 * Получает список активных remember tokens пользователя
 */
export async function getUserRememberTokens(userId: number) {
  return db
    .select({
      id: rememberTokensTable.id,
      deviceInfo: rememberTokensTable.deviceInfo,
      ipAddress: rememberTokensTable.ipAddress,
      createdAt: rememberTokensTable.createdAt,
      lastUsedAt: rememberTokensTable.lastUsedAt,
      expiresAt: rememberTokensTable.expiresAt,
    })
    .from(rememberTokensTable)
    .where(
      and(
        eq(rememberTokensTable.userId, userId),
        gt(rememberTokensTable.expiresAt, new Date()),
      ),
    )
    .orderBy(rememberTokensTable.lastUsedAt);
}

/**
 * Очищает все просроченные remember tokens (для cron-задачи)
 */
export async function cleanupExpiredRememberTokens(): Promise<number> {
  const result = await db
    .delete(rememberTokensTable)
    .where(lt(rememberTokensTable.expiresAt, new Date()))
    .returning({ id: rememberTokensTable.id });

  return result.length;
}
