import { Router } from "express";
import { eq, and, gt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod/v4";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  db,
  usersTable,
  emailVerificationTokensTable,
  passwordResetTokensTable,
  passwordChangeTokensTable,
  appSettingsTable,
  booksTable,
  bookUploadJobsTable,
  userSessionsTable,
  MAINTENANCE_MODE_KEY,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { emailService } from "../lib/email-service";
import { deleteStoredFilesIfUnreferenced } from "../lib/book-deletion-service";
import { resolveUploadPath } from "../lib/storage";
import { isRegistrationEnabled } from "../lib/registration-status";
import { logger } from "../lib/logger";
import type { Request } from "express";

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Слишком много попыток. Попробуйте позже" },
});
const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8),
  username: z.string().trim().min(2).max(80),
  referralSource: z.enum(["direct", "telegram", "habr", "productradar", "show_hn", "reddit", "vk", "seo", "other"]).optional().default("direct"),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  rememberMe: z.boolean().optional().default(false),
});

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function getSettingValue(key: string): Promise<string | null> {
  const [setting] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, key));

  return setting?.value ?? null;
}

router.post("/auth/register", authLimiter, async (req, res): Promise<void> => {
  if (!(await isRegistrationEnabled())) {
    res.status(403).json({ error: "Регистрация временно закрыта" });
    return;
  }

  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error:
        "Проверьте email, имя и пароль. Пароль должен быть не менее 8 символов",
    });
    return;
  }
  const { email, password, username, referralSource } = parsed.data;

  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email уже зарегистрирован" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      username,
      passwordHash,
      emailVerified: !emailService.isEnabled(), // Auto-verify if email disabled
      emailVerifiedAt: emailService.isEnabled() ? null : new Date(),
      analyticsOptIn: true,
      referralSource,
    })
    .returning();

  // Create verification token if email enabled
  if (emailService.isEnabled()) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db.insert(emailVerificationTokensTable).values({
      userId: user.id,
      token,
      expiresAt,
    });

    const baseUrl = process.env.APP_ORIGIN || "http://localhost:3000";
    await emailService.sendEmailVerification(email, username, token, baseUrl);

    // Don't create session - user must verify email and login
    res.status(201).json({
      user: formatUser(user),
      message:
        "Проверьте email для подтверждения. После подтверждения войдите в систему.",
    });
    return;
  }

  // Email verification disabled - create session immediately
  await regenerateSession(req);
  req.session.userId = user.id;
  res.status(201).json({
    user: formatUser(user),
  });
});

router.post("/auth/login", authLimiter, async (req, res): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Email и пароль обязательны" });
    return;
  }
  const { email, password, rememberMe } = parsed.data;

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }
  if (user.status === "blocked") {
    res.status(401).json({ error: "Аккаунт заблокирован" });
    return;
  }

  if (!user.emailVerified && emailService.isEnabled()) {
    res.status(403).json({
      error: "Подтвердите email перед входом",
      code: "EMAIL_NOT_VERIFIED",
      userId: user.id,
    });
    return;
  }

  if (!user.passwordHash) {
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }

  if (
    user.role !== "admin" &&
    user.role !== "moderator" &&
    (await getSettingValue(MAINTENANCE_MODE_KEY)) === "true"
  ) {
    res.status(403).json({
      error: "Вход временно недоступен из-за технического обслуживания",
      code: "MAINTENANCE_MODE",
    });
    return;
  }

  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, user.id));

  // Новая сессия после аутентификации предотвращает session fixation.
  await regenerateSession(req);

  // Устанавливаем userId.
  req.session.userId = user.id;

  // ✅ Создаем remember token если пользователь выбрал "Запомнить меня"
  if (rememberMe) {
    const { createRememberToken } = await import("../lib/remember-token-service");
    try {
      const rememberToken = await createRememberToken(user.id, req);
      const isProduction = process.env.NODE_ENV === "production";
      
      // Устанавливаем remember token в отдельную cookie (90 дней)
      res.cookie("readora.remember", rememberToken, {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        maxAge: 90 * 24 * 60 * 60 * 1000, // 90 дней
        path: "/",
      });
    } catch (error) {
      // Логируем ошибку, но не прерываем вход
      console.error("[auth/login] Failed to create remember token:", error);
    }
  }

  res.json({ user: formatUser(user) });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("readora.sid");
    res.clearCookie("readora.remember"); // ✅ Удаляем remember token
    res.sendStatus(204);
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
  res.json(formatUser(user));
});

router.patch(
  "/auth/me/settings",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as Request & { user: typeof usersTable.$inferSelect })
      .user;
    const updateSchema = z.object({
      username: z.string().trim().min(2).max(80).optional(),
      avatar: z.string().max(2048).nullable().optional(),
      analyticsOptIn: z.boolean().optional(),
    }).strict();
    const parsed = updateSchema.safeParse(req.body ?? {});
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      res.status(400).json({ error: "Некорректные настройки профиля" });
      return;
    }
    const { username, avatar, analyticsOptIn } = parsed.data;

    const updates: Partial<typeof usersTable.$inferSelect> = {};
    if (username != null) updates.username = username;
    if (avatar !== undefined) updates.avatar = avatar;
    if (analyticsOptIn !== undefined) updates.analyticsOptIn = analyticsOptIn;

    const [updated] = await db
      .update(usersTable)
      .set(updates)
      .where(eq(usersTable.id, user.id))
      .returning();
    res.json(formatUser(updated));
  },
);

router.post(
  "/auth/me/password",
  requireAuth,
  async (req, res): Promise<void> => {
    const user = (req as Request & { user: typeof usersTable.$inferSelect })
      .user;
    const schema = z.object({
      currentPassword: z.string().min(1),
      newPassword: z.string().min(8),
    });

    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: "Укажите текущий пароль и новый пароль не короче 8 символов",
      });
      return;
    }

    const { currentPassword, newPassword } = parsed.data;
    if (!user.passwordHash) {
      res.status(400).json({ error: "Пароль не задан для этой учётной записи" });
      return;
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      res.status(400).json({ error: "Текущий пароль неверный" });
      return;
    }

    if (currentPassword === newPassword) {
      res
        .status(400)
        .json({ error: "Новый пароль должен отличаться от текущего" });
      return;
    }

    if (!emailService.isEnabled()) {
      res.status(400).json({
        error: "Подтверждение смены пароля недоступно: SMTP отключен",
      });
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const passwordHash = await bcrypt.hash(newPassword, 12);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db
      .delete(passwordChangeTokensTable)
      .where(eq(passwordChangeTokensTable.userId, user.id));
    await db.insert(passwordChangeTokensTable).values({
      userId: user.id,
      token,
      newPasswordHash: passwordHash,
      expiresAt,
    });

    const baseUrl = process.env.APP_ORIGIN || "http://localhost:3000";
    const sent = await emailService.sendPasswordChangeConfirmation(
      user.email,
      user.username,
      token,
      baseUrl,
    );
    if (!sent) {
      await db
        .delete(passwordChangeTokensTable)
        .where(eq(passwordChangeTokensTable.token, token));
      res
        .status(503)
        .json({ error: "Не удалось отправить письмо подтверждения" });
      return;
    }

    res.json({ message: "Мы отправили письмо с подтверждением смены пароля" });
  },
);

router.post(
  "/auth/me/delete",
  requireAuth,
  authLimiter,
  async (req, res): Promise<void> => {
    const user = (req as Request & { user: typeof usersTable.$inferSelect })
      .user;
    const schema = z.object({
      currentPassword: z.string().min(1).max(1024),
      confirmation: z.literal("УДАЛИТЬ"),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error: 'Введите текущий пароль и фразу «УДАЛИТЬ»',
      });
      return;
    }

    if (user.role === "admin") {
      res.status(403).json({
        error:
          "Администратор не может удалить свою учётную запись самостоятельно",
      });
      return;
    }

    if (!user.passwordHash) {
      res.status(400).json({ error: "Пароль не задан для этой учётной записи" });
      return;
    }

    const valid = await bcrypt.compare(
      parsed.data.currentPassword,
      user.passwordHash,
    );
    if (!valid) {
      res.status(400).json({ error: "Текущий пароль неверный" });
      return;
    }

    const [books, uploadJobs] = await Promise.all([
      db.select().from(booksTable).where(eq(booksTable.ownerUserId, user.id)),
      db
        .select()
        .from(bookUploadJobsTable)
        .where(eq(bookUploadJobsTable.ownerUserId, user.id)),
    ]);

    await db.transaction(async (tx) => {
      await tx
        .delete(userSessionsTable)
        .where(sql`${userSessionsTable.sess}->>'userId' = ${String(user.id)}`);
      await tx.delete(usersTable).where(eq(usersTable.id, user.id));
    });

    await new Promise<void>((resolve) => {
      req.session.destroy(() => resolve());
    });
    res.clearCookie("readora.sid");
    res.clearCookie("readora.remember");

    for (const book of books) {
      try {
        await deleteStoredFilesIfUnreferenced(book);
      } catch {
        console.error("Failed to delete an account book file");
      }
    }

    for (const job of uploadJobs) {
      try {
        fs.rmSync(
          resolveUploadPath(path.join("tmp", job.tempStorageKey)),
          { force: true },
        );
      } catch {
        console.error("Failed to delete an account temporary upload");
      }
    }

    res.sendStatus(204);
  },
);

router.get(
  "/auth/confirm-password-change/:token",
  async (req, res): Promise<void> => {
    const { token } = req.params;
    if (!token) {
      res.status(400).json({ error: "Токен подтверждения отсутствует" });
      return;
    }

    const [changeToken] = await db
      .select()
      .from(passwordChangeTokensTable)
      .where(
        and(
          eq(passwordChangeTokensTable.token, token),
          gt(passwordChangeTokensTable.expiresAt, new Date()),
        ),
      );

    if (!changeToken) {
      res
        .status(400)
        .json({ error: "Недействительная или истекшая ссылка подтверждения" });
      return;
    }

    await db
      .update(usersTable)
      .set({ passwordHash: changeToken.newPasswordHash, updatedAt: new Date() })
      .where(eq(usersTable.id, changeToken.userId));

    await db
      .delete(passwordChangeTokensTable)
      .where(eq(passwordChangeTokensTable.userId, changeToken.userId));

    res.json({ message: "Пароль успешно изменен" });
  },
);

// Email verification
router.get("/auth/verify/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [verificationToken] = await db
    .select()
    .from(emailVerificationTokensTable)
    .where(
      and(
        eq(emailVerificationTokensTable.token, token),
        gt(emailVerificationTokensTable.expiresAt, new Date()),
      ),
    );

  if (!verificationToken) {
    res
      .status(400)
      .json({ error: "Недействительная или истекшая ссылка подтверждения" });
    return;
  }

  await db
    .update(usersTable)
    .set({ emailVerified: true, emailVerifiedAt: new Date() })
    .where(eq(usersTable.id, verificationToken.userId));

  await db
    .delete(emailVerificationTokensTable)
    .where(eq(emailVerificationTokensTable.userId, verificationToken.userId));

  res.json({ message: "Email успешно подтвержден" });
});

// Resend email verification (public route for users who can't login)
router.post(
  "/auth/resend-verification",
  authLimiter,
  async (req, res): Promise<void> => {
    try {
      const userIdSchema = z.object({ userId: z.number() });
      const parsed = userIdSchema.safeParse(req.body ?? {});

      if (!parsed.success) {
        // Return success for security (don't reveal if user exists)
        res.json({ message: "Если аккаунт существует, письмо отправлено" });
        return;
      }

      const { userId } = parsed.data;
      const [user] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, userId));

      if (!user) {
        // Return success for security (don't reveal if user exists)
        res.json({ message: "Если аккаунт существует, письмо отправлено" });
        return;
      }

      if (user.emailVerified) {
        res.json({ message: "Если аккаунт существует, письмо отправлено" });
        return;
      }

      if (!emailService.isEnabled()) {
        res.json({ message: "Если аккаунт существует, письмо отправлено" });
        return;
      }

      // Delete old verification tokens
      await db
        .delete(emailVerificationTokensTable)
        .where(eq(emailVerificationTokensTable.userId, user.id));

      // Create new token
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await db.insert(emailVerificationTokensTable).values({
        userId: user.id,
        token,
        expiresAt,
      });

      const baseUrl = process.env.APP_ORIGIN || "http://localhost:3000";
      await emailService.sendEmailVerification(
        user.email,
        user.username,
        token,
        baseUrl,
      );

      res.json({ message: "Если аккаунт существует, письмо отправлено" });
    } catch (error) {
      // Always return success for security
      res.json({ message: "Если аккаунт существует, письмо отправлено" });
    }
  },
);

// Forgot password
router.post(
  "/auth/forgot-password",
  authLimiter,
  async (req, res): Promise<void> => {
    const emailSchema = z.object({ email: z.string().email() });
    const parsed = emailSchema.safeParse(req.body ?? {});

    if (!parsed.success) {
      res.status(400).json({ error: "Укажите корректный email" });
      return;
    }

    const { email } = parsed.data;
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase().trim()));

    // Always return success to prevent email enumeration
    if (!user) {
      res.json({
        message:
          "Если аккаунт существует, вы получите письмо для сброса пароля",
      });
      return;
    }

    if (user.status === "blocked") {
      res.json({
        message:
          "Если аккаунт существует, вы получите письмо для сброса пароля",
      });
      return;
    }

    if (!emailService.isEnabled()) {
      res.status(400).json({ error: "Email функционал отключен" });
      return;
    }

    // Delete existing tokens
    await db
      .delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, user.id));

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.insert(passwordResetTokensTable).values({
      userId: user.id,
      token,
      expiresAt,
    });

    const baseUrl = process.env.APP_ORIGIN || "http://localhost:3000";
    await emailService.sendPasswordReset(
      user.email,
      user.username,
      token,
      baseUrl,
    );

    res.json({
      message: "Если аккаунт существует, вы получите письмо для сброса пароля",
    });
  },
);

// Reset password
router.post(
  "/auth/reset-password",
  authLimiter,
  async (req, res): Promise<void> => {
    const resetSchema = z.object({
      token: z.string(),
      newPassword: z.string().min(8),
    });

    const parsed = resetSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({
        error:
          "Токен и новый пароль обязательны. Пароль должен быть не менее 8 символов",
      });
      return;
    }

    const { token, newPassword } = parsed.data;

    const [resetToken] = await db
      .select()
      .from(passwordResetTokensTable)
      .where(
        and(
          eq(passwordResetTokensTable.token, token),
          gt(passwordResetTokensTable.expiresAt, new Date()),
        ),
      );

    if (!resetToken) {
      res
        .status(400)
        .json({ error: "Недействительная или истекшая ссылка сброса пароля" });
      return;
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await db
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, resetToken.userId));

    await db
      .delete(passwordResetTokensTable)
      .where(eq(passwordResetTokensTable.userId, resetToken.userId));

    res.json({ message: "Пароль успешно обновлен" });
  },
);

// --- Yandex OAuth ---

const YANDEX_AUTH_BASE = "https://oauth.yandex.ru";
const YANDEX_TOKEN_URL = `${YANDEX_AUTH_BASE}/token`;
const YANDEX_USER_INFO_URL = "https://login.yandex.ru/info";
const YANDEX_REDIRECT_PATH = "/api/auth/yandex/callback";

interface YandexTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  error?: string;
}

interface YandexUserInfo {
  id: string;
  login: string;
  default_email?: string;
  emails?: string[];
}

function getYandexEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function getYandexRedirectUri(): string {
  const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return `${appOrigin.replace(/\/$/, "")}${YANDEX_REDIRECT_PATH}`;
}

function getYandexTokenErrorMessage(providerError?: string): string {
  switch (providerError) {
    case "invalid_client":
      return "Яндекс отклонил Client ID или Client secret. Проверьте значения и перезапустите сервер.";
    case "invalid_grant":
      return "Код входа Яндекса истёк или уже был использован. Начните вход заново.";
    case "invalid_scope":
      return "Настройки разрешений Яндекс ID изменились. Начните вход заново.";
    case "unauthorized_client":
      return "Приложение Яндекс ID недоступно или ожидает модерации.";
    default:
      return "Не удалось получить токен Яндекса. Повторите вход.";
  }
}

router.get("/auth/yandex", (req, res): void => {
  const env = getYandexEnv();
  if (!env) {
    res.status(503).json({ error: "Вход через Яндекс не настроен" });
    return;
  }

  const state = crypto.randomBytes(32).toString("base64url");
  req.session.yandexOAuthState = state;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: getYandexRedirectUri(),
    scope: "login:email",
    state,
  });
  res.redirect(`${YANDEX_AUTH_BASE}/authorize?${params.toString()}`);
});

router.get("/auth/yandex/callback", async (req, res): Promise<void> => {
  const env = getYandexEnv();
  if (!env) {
    res.status(503).json({ error: "Вход через Яндекс не настроен" });
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    res.status(400).json({ error: "Код подтверждения отсутствует" });
    return;
  }

  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!state || state !== req.session.yandexOAuthState) {
    res.status(400).json({ error: "Недействительный запрос авторизации" });
    return;
  }

  let tokenData: YandexTokenResponse;
  try {
    const tokenRes = await fetch(YANDEX_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    });
    const tokenResponse = (await tokenRes.json()) as YandexTokenResponse;
    if (!tokenRes.ok || !tokenResponse.access_token) {
      logger.warn(
        { statusCode: tokenRes.status, providerError: tokenResponse.error ?? "missing_access_token" },
        "Yandex OAuth token exchange failed",
      );
      res.status(502).json({ error: getYandexTokenErrorMessage(tokenResponse.error) });
      return;
    }
    tokenData = tokenResponse;
  } catch (error) {
    logger.warn({ err: error }, "Yandex OAuth token request failed");
    res.status(502).json({ error: "Не удалось получить токен Яндекса" });
    return;
  }

  let yandexUser: YandexUserInfo;
  try {
    const infoRes = await fetch(`${YANDEX_USER_INFO_URL}?format=json`, {
      headers: { Authorization: `OAuth ${tokenData.access_token}` },
    });
    if (!infoRes.ok) {
      logger.warn({ statusCode: infoRes.status }, "Yandex OAuth user-info request failed");
      res.status(502).json({ error: "Не удалось получить данные пользователя Яндекса" });
      return;
    }
    yandexUser = (await infoRes.json()) as YandexUserInfo;
  } catch {
    res.status(502).json({ error: "Не удалось получить данные пользователя Яндекса" });
    return;
  }

  if (!yandexUser.id || !yandexUser.login) {
    logger.warn("Yandex OAuth user-info response is missing required identity fields");
    res.status(502).json({ error: "Яндекс ID вернул неполные данные пользователя" });
    return;
  }

  const email = (yandexUser.default_email ?? yandexUser.emails?.[0] ?? "").toLowerCase().trim();
  if (!email) {
    res.status(400).json({ error: "Яндекс ID не вернул email. Добавьте разрешение login:email в настройках приложения." });
    return;
  }

  const [existingByYandexId] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.externalProvider, "yandex"), eq(usersTable.externalId, yandexUser.id)));
  const [existingByEmail] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  const existing = existingByYandexId ?? existingByEmail;

  if (!existing && !(await isRegistrationEnabled())) {
    res.status(403).json({ error: "Регистрация временно закрыта" });
    return;
  }

  const maintenanceMode = (await getSettingValue(MAINTENANCE_MODE_KEY)) === "true";
  if (maintenanceMode && (!existing || (existing.role !== "admin" && existing.role !== "moderator"))) {
    res.status(403).json({
      error: "Вход временно недоступен из-за технического обслуживания",
      code: "MAINTENANCE_MODE",
    });
    return;
  }

  let user;
  if (existing) {
    if (existing.externalProvider === "yandex" && existing.externalId === yandexUser.id) {
      user = existing;
    } else if (existing.externalProvider !== null || existing.externalId !== null) {
      res.status(409).json({ error: "Email уже привязан к другой учётной записи" });
      return;
    } else {
      await db
        .update(usersTable)
        .set({ externalProvider: "yandex", externalId: yandexUser.id })
        .where(eq(usersTable.id, existing.id));
      const [updated] = await db
        .select()
        .from(usersTable)
        .where(eq(usersTable.id, existing.id));
      user = updated;
    }
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({
        email,
        username: yandexUser.login,
        passwordHash: null,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        externalProvider: "yandex",
        externalId: yandexUser.id,
        referralSource: "direct",
      })
      .returning();
    user = created;
  }

  if (user.status === "blocked") {
    res.status(401).json({ error: "Аккаунт заблокирован" });
    return;
  }

  await db
    .update(usersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(usersTable.id, user.id));

  await regenerateSession(req);
  req.session.userId = user.id;

  const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  res.redirect(appOrigin.replace(/\/$/, "") + "/library");
});

function formatUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    role: u.role,
    status: u.status,
    avatar: u.avatar ?? null,
    emailVerified: u.emailVerified,
    analyticsOptIn: u.analyticsOptIn,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}

// GET /auth/trusted-devices - Получить список доверенных устройств
router.get("/auth/trusted-devices", requireAuth, async (req, res): Promise<void> => {
  const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
  const { getUserRememberTokens } = await import("../lib/remember-token-service");
  
  try {
    const devices = await getUserRememberTokens(user.id);
    res.json(devices);
  } catch (error) {
    res.status(500).json({ error: "Не удалось получить список устройств" });
  }
});

// DELETE /auth/trusted-devices/:id - Отозвать доступ для конкретного устройства
router.delete("/auth/trusted-devices/:id", requireAuth, async (req, res): Promise<void> => {
  const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
  const tokenId = Number.parseInt(String(req.params.id), 10);
  
  if (Number.isNaN(tokenId)) {
    res.status(400).json({ error: "Некорректный ID устройства" });
    return;
  }

  const { revokeRememberToken, getUserRememberTokens } = await import("../lib/remember-token-service");
  
  try {
    // Проверяем, что токен принадлежит текущему пользователю
    const devices = await getUserRememberTokens(user.id);
    const device = devices.find((d) => d.id === tokenId);
    
    if (!device) {
      res.status(404).json({ error: "Устройство не найдено" });
      return;
    }

    await revokeRememberToken(tokenId);
    res.json({ message: "Доступ для устройства отозван" });
  } catch (error) {
    res.status(500).json({ error: "Не удалось отозвать доступ" });
  }
});

// DELETE /auth/trusted-devices - Отозвать доступ для всех устройств
router.delete("/auth/trusted-devices", requireAuth, async (req, res): Promise<void> => {
  const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
  const { revokeAllUserRememberTokens } = await import("../lib/remember-token-service");
  
  try {
    const count = await revokeAllUserRememberTokens(user.id);
    res.json({ message: `Доступ отозван для ${count} устройств` });
  } catch (error) {
    res.status(500).json({ error: "Не удалось отозвать доступ" });
  }
});

export { formatUser };
export default router;
