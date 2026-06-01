import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, genresTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

const router = Router();

router.get("/genres", async (_req, res): Promise<void> => {
  const genres = await db.select().from(genresTable).orderBy(genresTable.name);
  res.json(genres);
});

router.post("/genres", requireAdmin, async (req, res): Promise<void> => {
  const { code, name, description } = req.body ?? {};
  if (!code || !name) {
    res.status(400).json({ error: "Код и название обязательны" });
    return;
  }
  const [genre] = await db.insert(genresTable).values({ code, name, description }).returning();
  res.status(201).json(genre);
});

router.patch("/genres/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const { code, name, description, isActive } = req.body ?? {};
  const updates: Partial<typeof genresTable.$inferSelect> = {};
  if (code != null) updates.code = code;
  if (name != null) updates.name = name;
  if (description !== undefined) updates.description = description;
  if (isActive !== undefined) updates.isActive = isActive;

  const [genre] = await db.update(genresTable).set(updates).where(eq(genresTable.id, id)).returning();
  if (!genre) { res.status(404).json({ error: "Жанр не найден" }); return; }
  res.json(genre);
});

router.delete("/genres/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  await db.delete(genresTable).where(eq(genresTable.id, id));
  res.sendStatus(204);
});

export default router;
