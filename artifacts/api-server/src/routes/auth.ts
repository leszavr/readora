import { Router } from "express";
import { eq, and, gt } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import crypto from "node:crypto";
import { db, usersTable, emailVerificationTokensTable, passwordResetTokensTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { emailService } from "../lib/email-service";
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
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

router.post("/auth/register", authLimiter, async (req, res): Promise<void> => {
  const parsed = registerSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Проверьте email, имя и пароль. Пароль должен быть не менее 8 символов" });
    return;
  }
  const { email, password, username } = parsed.data;

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (existing) {
    res.status(409).json({ error: "Email уже зарегистрирован" });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(usersTable).values({
    email,
    username,
    passwordHash,
    emailVerified: !emailService.isEnabled(), // Auto-verify if email disabled
  }).returning();

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
  }

  req.session.userId = user.id;
  res.status(201).json({ 
    user: formatUser(user),
    message: emailService.isEnabled() ? "Проверьте email для подтверждения" : undefined,
  });
});

router.post("/auth/login", authLimiter, async (req, res): Promise<void> => {
  const parsed = loginSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Email и пароль обязательны" });
    return;
  }
  const { email, password } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
  if (!user) {
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }
  if (user.status === "blocked") {
    res.status(401).json({ error: "Аккаунт заблокирован" });
    return;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Неверный email или пароль" });
    return;
  }

  await db.update(usersTable).set({ lastLoginAt: new Date() }).where(eq(usersTable.id, user.id));
  req.session.userId = user.id;
  res.json({ user: formatUser(user) });
});

router.post("/auth/logout", (req, res): void => {
  req.session.destroy(() => {
    res.clearCookie("readora.sid");
    res.sendStatus(204);
  });
});

router.get("/auth/me", requireAuth, async (req, res): Promise<void> => {
  const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
  res.json(formatUser(user));
});

router.patch("/auth/me/settings", requireAuth, async (req, res): Promise<void> => {
  const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
  const { username, avatar } = req.body ?? {};

  const updates: Partial<typeof usersTable.$inferSelect> = {};
  if (username != null) updates.username = username;
  if (avatar !== undefined) updates.avatar = avatar;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, user.id)).returning();
  res.json(formatUser(updated));
});

// Email verification
router.get("/auth/verify/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const [verificationToken] = await db
    .select()
    .from(emailVerificationTokensTable)
    .where(
      and(
        eq(emailVerificationTokensTable.token, token),
        gt(emailVerificationTokensTable.expiresAt, new Date())
      )
    );

  if (!verificationToken) {
    res.status(400).json({ error: "Недействительная или истекшая ссылка подтверждения" });
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

// Forgot password
router.post("/auth/forgot-password", authLimiter, async (req, res): Promise<void> => {
  const emailSchema = z.object({ email: z.string().email() });
  const parsed = emailSchema.safeParse(req.body ?? {});

  if (!parsed.success) {
    res.status(400).json({ error: "Укажите корректный email" });
    return;
  }

  const { email } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email.toLowerCase().trim()));

  // Always return success to prevent email enumeration
  if (!user) {
    res.json({ message: "Если аккаунт существует, вы получите письмо для сброса пароля" });
    return;
  }

  if (user.status === "blocked") {
    res.json({ message: "Если аккаунт существует, вы получите письмо для сброса пароля" });
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
  await emailService.sendPasswordReset(user.email, user.username, token, baseUrl);

  res.json({ message: "Если аккаунт существует, вы получите письмо для сброса пароля" });
});

// Reset password
router.post("/auth/reset-password", authLimiter, async (req, res): Promise<void> => {
  const resetSchema = z.object({
    token: z.string(),
    newPassword: z.string().min(8),
  });

  const parsed = resetSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Токен и новый пароль обязательны. Пароль должен быть не менее 8 символов" });
    return;
  }

  const { token, newPassword } = parsed.data;

  const [resetToken] = await db
    .select()
    .from(passwordResetTokensTable)
    .where(
      and(
        eq(passwordResetTokensTable.token, token),
        gt(passwordResetTokensTable.expiresAt, new Date())
      )
    );

  if (!resetToken) {
    res.status(400).json({ error: "Недействительная или истекшая ссылка сброса пароля" });
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
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}

export { formatUser };
export default router;
