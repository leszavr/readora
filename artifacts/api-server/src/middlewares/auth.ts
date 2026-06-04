import { type Request, type Response, type NextFunction } from "express";
import {
  db,
  usersTable,
  appSettingsTable,
  MAINTENANCE_MODE_KEY,
  MAINTENANCE_SESSION_VERSION_KEY,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { emailService } from "../lib/email-service";

// Helper function to check maintenance mode and session version
async function checkMaintenanceMode(
  req: Request,
  user: { role: string; id: number },
): Promise<{ blocked: boolean; reason?: string }> {
  // Администраторы не подвергаются проверке режима обслуживания
  if (user.role === "admin" || user.role === "moderator") {
    return { blocked: false };
  }

  // Получаем настройки режима обслуживания
  const settings = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, MAINTENANCE_MODE_KEY));

  const sessionVersionSetting = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, MAINTENANCE_SESSION_VERSION_KEY));

  const maintenanceMode = settings[0]?.value === "true";

  if (!maintenanceMode) {
    return { blocked: false };
  }

  // Проверяем версию сессии
  const currentSessionVersion = sessionVersionSetting[0]?.value || "0";
  const userSessionVersion =
    (req.session as { maintenanceVersion?: string }).maintenanceVersion || "0";

  if (userSessionVersion < currentSessionVersion) {
    return { blocked: true, reason: "maintenance_mode" };
  }

  return { blocked: false };
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user || user.status === "blocked") {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  // Check maintenance mode for non-admin users
  const maintenanceCheck = await checkMaintenanceMode(req, user);
  if (maintenanceCheck.blocked) {
    req.session.destroy(() => {});
    res.status(403).json({
      error: "Сессия завершена из-за технического обслуживания",
      code: "MAINTENANCE_MODE",
    });
    return;
  }

  // Check email verification if email service is enabled
  if (emailService.isEnabled() && !user.emailVerified) {
    res.status(403).json({
      error: "Подтвердите email перед входом",
      code: "EMAIL_NOT_VERIFIED",
    });
    return;
  }

  (req as Request & { user: typeof user }).user = user;
  next();
}

export async function requireAuthWithoutEmailCheck(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, userId));
  if (!user || user.status === "blocked") {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  (req as Request & { user: typeof user }).user = user;
  next();
}

export async function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = (req as Request & { user: { role: string } }).user;
    if (!user || (user.role !== "admin" && user.role !== "moderator")) {
      res.status(403).json({ error: "Доступ запрещён" });
      return;
    }
    next();
  });
}
