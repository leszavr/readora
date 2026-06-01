import { type Request, type Response, type NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = req.session.userId;
  if (!userId) {
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId));
  if (!user || user.status === "blocked") {
    req.session.destroy(() => {});
    res.status(401).json({ error: "Не авторизован" });
    return;
  }

  (req as Request & { user: typeof user }).user = user;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = (req as Request & { user: { role: string } }).user;
    if (!user || (user.role !== "admin" && user.role !== "moderator")) {
      res.status(403).json({ error: "Доступ запрещён" });
      return;
    }
    next();
  });
}
