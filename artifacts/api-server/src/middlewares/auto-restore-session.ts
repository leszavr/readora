import { type Request, type Response, type NextFunction } from "express";
import { validateRememberToken } from "../lib/remember-token-service";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

const REMEMBER_TOKEN_COOKIE_NAME = "readora.remember";

/**
 * Middleware для автоматического восстановления сессии из remember token
 * Должен быть установлен ПЕРЕД любыми защищенными роутами
 */
export async function autoRestoreSession(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Если сессия уже существует, продолжаем без проверки remember token
  if (req.session.userId) {
    next();
    return;
  }

  // Проверяем наличие remember token в cookie
  const rememberToken = req.cookies[REMEMBER_TOKEN_COOKIE_NAME];
  if (!rememberToken || typeof rememberToken !== "string") {
    next();
    return;
  }

  try {
    // Валидируем remember token
    const userId = await validateRememberToken(rememberToken);

    if (!userId) {
      // Токен невалиден или истек - удаляем cookie
      res.clearCookie(REMEMBER_TOKEN_COOKIE_NAME);
      next();
      return;
    }

    // Получаем пользователя
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, userId));

    if (!user || user.status === "blocked") {
      res.clearCookie(REMEMBER_TOKEN_COOKIE_NAME);
      next();
      return;
    }

    // ✅ Восстанавливаем сессию
    req.session.userId = userId;

    // Обновляем lastLoginAt
    await db
      .update(usersTable)
      .set({ lastLoginAt: new Date() })
      .where(eq(usersTable.id, userId));

    logger.info(
      { userId, email: user.email },
      "Session auto-restored from remember token",
    );

    next();
  } catch (error) {
    logger.error({ error }, "Error auto-restoring session from remember token");
    // В случае ошибки просто продолжаем без восстановления сессии
    res.clearCookie(REMEMBER_TOKEN_COOKIE_NAME);
    next();
  }
}
