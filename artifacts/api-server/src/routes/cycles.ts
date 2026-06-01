import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, cyclesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import type { Request } from "express";
import type { usersTable } from "@workspace/db";

const router = Router();

router.get("/cycles", requireAuth, async (req, res): Promise<void> => {
  const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
  const cycles = await db.select().from(cyclesTable).where(eq(cyclesTable.ownerUserId, user.id));
  res.json(cycles.map((c) => ({ id: c.id, name: c.name, description: c.description ?? null, createdAt: c.createdAt })));
});

router.post("/cycles", requireAuth, async (req, res): Promise<void> => {
  const user = (req as Request & { user: typeof usersTable.$inferSelect }).user;
  const { name, description } = req.body ?? {};
  if (!name) { res.status(400).json({ error: "Название обязательно" }); return; }
  const [cycle] = await db.insert(cyclesTable).values({ ownerUserId: user.id, name, description }).returning();
  res.status(201).json({ id: cycle.id, name: cycle.name, description: cycle.description ?? null, createdAt: cycle.createdAt });
});

export default router;
