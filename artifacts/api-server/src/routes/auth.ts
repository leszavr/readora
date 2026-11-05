import { Router } from "express";
import { eq, and, gt, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod/v4";
import crypto from "node:crypto";
import {
  db,
  usersTable,
  emailVerificationTokensTable,
  passwordResetTokensTable,
  passwordChangeTokensTable,
  appSettingsTable,
  userSessionsTable,
  MAINTENANCE_MODE_KEY,
} from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { emailService } from "../lib/email-service";
import { hashAuthToken } from "../lib/token-hash";
import { isRegistrationEnabled } from "../lib/registration-status";
import { logger } from "../lib/logger";
import { completeYandexDiskConnect } from "../lib/external-storage/yandex-connect";
import { isExternalStorageEnabled, externalStorageDisabledMessage } from "../lib/external-storage/feature";
import { grantGiftEditionsOnSignup, userOwnsGiftSourcesInUse } from "../lib/gift-editions-service";
import {
  consumeVkOAuthState,
  createVkPkceChallenge,
  readVkCallbackParams,
} from "../lib/vk-oauth";
import {
  DELETION_GRACE_DAYS,
  scheduleAccountDeletion,
} from "../lib/account-deletion-service";
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
  await grantGiftEditionsOnSignup(user.id);

  // Create verification token if email enabled
  if (emailService.isEnabled()) {
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await db.insert(emailVerificationTokensTable).values({
      userId: user.id,
      token: hashAuthToken(token),
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

  // Аккаунт в процессе удаления: вход блокируется, сессия не создаётся.
  // Фронтенд по коду показывает экран с датой очистки и контактами поддержки.
  if (user.scheduledDeletionAt) {
    res.status(403).json({
      error: "Аккаунт находится в процессе удаления",
      code: "ACCOUNT_PENDING_DELETION",
      scheduledFor: user.scheduledDeletionAt.toISOString(),
    });
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
      token: hashAuthToken(token),
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
        .where(eq(passwordChangeTokensTable.token, hashAuthToken(token)));
      res
        .status(503)
        .json({ error: "Не удалось отправить письмо подтверждения" });
      return;
    }

    res.json({ message: "Мы отправили письмо с подтверждением смены пароля" });
  },
);

// --- Удаление аккаунта (модель GitHub) ---
//
// Подтверждение личности не требуется: действует сессия пользователя,
// а защита от случайного удаления — сгенерированный 8-значный код, который
// показывается во втором окне и вводится вручную (анти-«мышечная память»).
// Способ авторизации (пароль / VK ID / Яндекс ID) не влияет на флоу.
// Удаление отложено на grace period, вход блокируется, восстановление —
// через администрацию (форма обратной связи / email поддержки).

// TTL кода подтверждения удаления, выданного preview-эндпоинтом.
const DELETION_CODE_TTL_MS = 10 * 60 * 1000;

function generateDeletionCode(): string {
  return String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
}

// GET /auth/me/delete/preview — код для второго окна подтверждения.
router.get(
  "/auth/me/delete/preview",
  requireAuth,
  authLimiter,
  async (req, res): Promise<void> => {
    const user = (req as Request & { user: typeof usersTable.$inferSelect })
      .user;

    const code = generateDeletionCode();
    req.session.deletionCode = code;
    req.session.deletionCodeIssuedAt = Date.now();

    res.json({
      code,
      graceDays: DELETION_GRACE_DAYS,
      email: user.email,
    });
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
      code: z.string().trim().regex(/^\d{8}$/),
    });
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "Введите 8-значный код подтверждения" });
      return;
    }

    if (user.role === "admin") {
      res.status(403).json({
        error:
          "Администратор не может удалить свою учётную запись самостоятельно",
      });
      return;
    }

    // Код сверяется с выданным preview-эндпоинтом и живёт ограниченное время.
    const expectedCode = req.session.deletionCode;
    const issuedAt = req.session.deletionCodeIssuedAt;
    const codeValid =
      expectedCode !== undefined &&
      issuedAt !== undefined &&
      Date.now() - issuedAt <= DELETION_CODE_TTL_MS &&
      expectedCode === parsed.data.code;
    if (!codeValid) {
      res.status(400).json({
        error: "Код неверен или устарел. Откройте подтверждение заново.",
      });
      return;
    }

    if (await userOwnsGiftSourcesInUse(user.id)) {
      res.status(409).json({ error: "Ваши книги выданы пользователям как подарочные издания. Обратитесь к администратору." });
      return;
    }

    const { scheduledFor } = await scheduleAccountDeletion(user, "user");

    // scheduleAccountDeletion аннулировал все сессии в БД; завершаем текущую.
    await new Promise<void>((resolve) => {
      req.session.destroy(() => resolve());
    });
    res.clearCookie("readora.sid");
    res.clearCookie("readora.remember");

    res.json({
      scheduledFor: scheduledFor.toISOString(),
      graceDays: DELETION_GRACE_DAYS,
    });
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
          eq(passwordChangeTokensTable.token, hashAuthToken(token)),
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

    // Смена пароля аннулирует все сессии и «запомнить меня»-токены:
    // украденная сессия не должна переживать смену пароля жертвой.
    await db
      .delete(userSessionsTable)
      .where(sql`${userSessionsTable.sess}->>'userId' = ${String(changeToken.userId)}`);
    const { revokeAllUserRememberTokens } = await import("../lib/remember-token-service");
    await revokeAllUserRememberTokens(changeToken.userId);

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
        eq(emailVerificationTokensTable.token, hashAuthToken(token)),
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
        token: hashAuthToken(token),
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
      token: hashAuthToken(token),
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
          eq(passwordResetTokensTable.token, hashAuthToken(token)),
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

    // Сброс пароля аннулирует все сессии и «запомнить меня»-токены:
    // украденная сессия не должна переживать сброс пароля.
    await db
      .delete(userSessionsTable)
      .where(sql`${userSessionsTable.sess}->>'userId' = ${String(resetToken.userId)}`);
    const { revokeAllUserRememberTokens } = await import("../lib/remember-token-service");
    await revokeAllUserRememberTokens(resetToken.userId);

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

  // Подключение Яндекс.Диска использует тот же Callback URL, что и вход
  // (в приложении Яндекса зарегистрирован один redirect_uri): поток
  // различаем по state из сессии.
  const diskConnectState = req.session.yandexDiskConnectState;
  if (diskConnectState && state && state === diskConnectState) {
    delete req.session.yandexDiskConnectState;
    const appOrigin = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
    const failConnect = (message: string): void => {
      res.redirect(`${appOrigin}/profile?storage=error&message=${encodeURIComponent(message)}`);
    };
    if (!(await isExternalStorageEnabled())) {
      failConnect(externalStorageDisabledMessage());
      return;
    }
    if (!req.session.userId) {
      failConnect("Сессия истекла. Войдите снова и повторите подключение хранилища.");
      return;
    }
    try {
      await completeYandexDiskConnect(req.session.userId, code);
      res.redirect(`${appOrigin}/profile?storage=connected`);
    } catch (error) {
      logger.warn({ err: error }, "Yandex Disk connect callback failed");
      failConnect(error instanceof Error ? error.message : "Не удалось подключить Яндекс.Диск");
    }
    return;
  }

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
    await grantGiftEditionsOnSignup(created.id);
    user = created;
  }

  if (user.status === "blocked") {
    res.status(401).json({ error: "Аккаунт заблокирован" });
    return;
  }

  // Аккаунт в процессе удаления: сессию не создаём, ведём на экран
  // блокировки с датой окончательной очистки (как и при входе по паролю).
  if (user.scheduledDeletionAt) {
    const appOrigin = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
    res.redirect(
      `${appOrigin}/login?deletion=pending&until=${encodeURIComponent(user.scheduledDeletionAt.toISOString())}`,
    );
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

// --- VK ID OAuth ---

const VK_AUTH_URL = "https://id.vk.ru/authorize";
const VK_TOKEN_URL = "https://id.vk.ru/oauth2/auth";
const VK_USER_INFO_URL = "https://id.vk.ru/oauth2/user_info";
const VK_REDIRECT_PATH = "/api/auth/vk/callback";

interface VkTokenResponse {
  access_token?: string;
  user_id?: string | number;
  state?: string;
  error?: string;
  error_description?: string;
}

interface VkUserInfoResponse {
  user?: {
    user_id?: string | number;
    first_name?: string;
    last_name?: string;
    avatar?: string;
    email?: string;
  };
  user_id?: string | number;
  first_name?: string;
  last_name?: string;
  avatar?: string;
  email?: string;
}

function getVkEnv(): { clientId: string; serviceToken: string } | null {
  const clientId = process.env.VK_CLIENT_ID;
  const serviceToken = process.env.VK_SERVICE_TOKEN;
  if (!clientId || !serviceToken) return null;
  return { clientId, serviceToken };
}

function getVkRedirectUri(): string {
  const appOrigin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return `${appOrigin.replace(/\/$/, "")}${VK_REDIRECT_PATH}`;
}

function createPkceVerifier(): string {
  return crypto.randomBytes(48).toString("base64url");
}

router.get("/auth/vk/config", (req, res): void => {
  const env = getVkEnv();
  if (!env) {
    res.status(503).json({ error: "Вход через VK ID не настроен" });
    return;
  }

  const state = crypto.randomBytes(32).toString("base64url");
  const codeVerifier = createPkceVerifier();
  req.session.vkOAuthState = state;
  req.session.vkOAuthCodeVerifier = codeVerifier;

  res.json({
    clientId: env.clientId,
    redirectUri: getVkRedirectUri(),
    state,
    codeChallenge: createVkPkceChallenge(codeVerifier),
  });
});

router.get("/auth/vk", (req, res): void => {
  const env = getVkEnv();
  if (!env) {
    res.status(503).json({ error: "Вход через VK ID не настроен" });
    return;
  }

  const state = crypto.randomBytes(32).toString("base64url");
  const codeVerifier = createPkceVerifier();
  req.session.vkOAuthState = state;
  req.session.vkOAuthCodeVerifier = codeVerifier;

  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.clientId,
    redirect_uri: getVkRedirectUri(),
    state,
    code_challenge: createVkPkceChallenge(codeVerifier),
    code_challenge_method: "S256",
    scope: "email vkid.personal_info",
  });
  res.redirect(`${VK_AUTH_URL}?${params.toString()}`);
});

router.get("/auth/vk/callback", async (req, res): Promise<void> => {
  const env = getVkEnv();
  if (!env) {
    res.status(503).json({ error: "Вход через VK ID не настроен" });
    return;
  }

  const { code, state, deviceId } = readVkCallbackParams(req);
  const codeVerifier = consumeVkOAuthState(req.session, state);

  if (!code || !deviceId || !codeVerifier) {
    res.status(400).json({ error: "Недействительный запрос авторизации VK ID" });
    return;
  }

  let tokenData: VkTokenResponse;
  try {
    const tokenRes = await fetch(VK_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: env.clientId,
        service_token: env.serviceToken,
        code,
        code_verifier: codeVerifier,
        device_id: deviceId,
        redirect_uri: getVkRedirectUri(),
        state,
      }).toString(),
    });
    const tokenResponse = (await tokenRes.json()) as VkTokenResponse;
    if (!tokenRes.ok || !tokenResponse.access_token) {
      logger.warn(
        { statusCode: tokenRes.status, providerError: tokenResponse.error ?? "missing_access_token" },
        "VK ID OAuth token exchange failed",
      );
      res.status(502).json({ error: "Не удалось получить токен VK ID. Повторите вход." });
      return;
    }
    tokenData = tokenResponse;
  } catch (error) {
    logger.warn({ err: error }, "VK ID OAuth token request failed");
    res.status(502).json({ error: "Не удалось получить токен VK ID" });
    return;
  }

  let vkUserInfo: VkUserInfoResponse;
  try {
    const accessToken = tokenData.access_token;
    if (!accessToken) {
      res.status(502).json({ error: "VK ID не вернул токен доступа" });
      return;
    }
    const infoRes = await fetch(VK_USER_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        access_token: accessToken,
        client_id: env.clientId,
      }).toString(),
    });
    if (!infoRes.ok) {
      logger.warn({ statusCode: infoRes.status }, "VK ID user-info request failed");
      res.status(502).json({ error: "Не удалось получить данные пользователя VK ID" });
      return;
    }
    vkUserInfo = (await infoRes.json()) as VkUserInfoResponse;
  } catch (error) {
    logger.warn({ err: error }, "VK ID user-info request failed");
    res.status(502).json({ error: "Не удалось получить данные пользователя VK ID" });
    return;
  }

  const vkUser = vkUserInfo.user ?? vkUserInfo;
  const externalId = String(vkUser.user_id ?? tokenData.user_id ?? "");
  const email = (vkUser.email ?? "").toLowerCase().trim();
  if (!externalId || !email) {
    res.status(400).json({ error: "VK ID не вернул email. Разрешите доступ к почте в настройках приложения." });
    return;
  }

  const [existingByVkId] = await db
    .select()
    .from(usersTable)
    .where(and(eq(usersTable.externalProvider, "vk"), eq(usersTable.externalId, externalId)));
  const [existingByEmail] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email));
  const existing = existingByVkId ?? existingByEmail;

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
    if (existing.externalProvider === "vk" && existing.externalId === externalId) {
      user = existing;
    } else if (existing.externalProvider !== null || existing.externalId !== null) {
      res.status(409).json({ error: "Email уже привязан к другой учётной записи" });
      return;
    } else {
      await db
        .update(usersTable)
        .set({ externalProvider: "vk", externalId })
        .where(eq(usersTable.id, existing.id));
      const [updated] = await db.select().from(usersTable).where(eq(usersTable.id, existing.id));
      user = updated;
    }
  } else {
    const username = [vkUser.first_name, vkUser.last_name].filter(Boolean).join(" ").trim() || `VK ${externalId}`;
    const [created] = await db
      .insert(usersTable)
      .values({
        email,
        username: username.slice(0, 80),
        passwordHash: null,
        emailVerified: true,
        emailVerifiedAt: new Date(),
        externalProvider: "vk",
        externalId,
        avatar: vkUser.avatar ?? null,
        referralSource: "vk",
      })
      .returning();
    await grantGiftEditionsOnSignup(created.id);
    user = created;
  }

  if (user.status === "blocked") {
    res.status(401).json({ error: "Аккаунт заблокирован" });
    return;
  }

  // Аккаунт в процессе удаления: сессию не создаём, ведём на экран
  // блокировки с датой окончательной очистки (как и при входе по паролю).
  if (user.scheduledDeletionAt) {
    const appOrigin = (process.env.APP_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
    res.redirect(
      `${appOrigin}/login?deletion=pending&until=${encodeURIComponent(user.scheduledDeletionAt.toISOString())}`,
    );
    return;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
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
    scheduledDeletionAt: u.scheduledDeletionAt ?? null,
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
