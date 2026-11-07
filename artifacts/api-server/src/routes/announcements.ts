import { Router, type Request } from "express";
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  adminAnnouncementsTable,
  db,
  userAnnouncementReadsTable,
  usersTable,
} from "@workspace/db";
import { requireAdmin, requireAuth } from "../middlewares/auth";

const router = Router();

// Сообщения старше этого срока не участвуют в подсчёте непрочитанных и
// автоматически считаются прочитанными (дедупликация бэклога для новых юзеров).
const UNREAD_TTL_DAYS = 30;

type AuthReq = Request & { user: typeof usersTable.$inferSelect };

const upsertSchema = z.object({
  kind: z.enum(["announcement", "release"]).default("announcement"),
  severity: z.enum(["info", "warning"]).default("info"),
  color: z.enum(["yellow", "green", "blue", "pink", "purple"]).default("blue"),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(5000),
});

function parseId(value: unknown): number | null {
  const id = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// GET /announcements — активные оповещения для текущего пользователя
router.get("/announcements", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;

  const rows = await db
    .select({
      id: adminAnnouncementsTable.id,
      kind: adminAnnouncementsTable.kind,
      severity: adminAnnouncementsTable.severity,
      color: adminAnnouncementsTable.color,
      title: adminAnnouncementsTable.title,
      body: adminAnnouncementsTable.body,
      publishedAt: adminAnnouncementsTable.publishedAt,
      readAt: userAnnouncementReadsTable.readAt,
    })
    .from(adminAnnouncementsTable)
    .leftJoin(
      userAnnouncementReadsTable,
      and(
        eq(userAnnouncementReadsTable.announcementId, adminAnnouncementsTable.id),
        eq(userAnnouncementReadsTable.userId, user.id),
      ),
    )
    .where(isNull(adminAnnouncementsTable.archivedAt))
    .orderBy(desc(adminAnnouncementsTable.publishedAt));

  const ttlMs = Date.now() - UNREAD_TTL_DAYS * 24 * 60 * 60 * 1000;
  const unreadCount = rows.filter(
    (row) => row.readAt === null && row.publishedAt.getTime() >= ttlMs,
  ).length;

  res.json({ unreadCount, items: rows });
});

// GET /announcements/changelog — полный Changelog платформы (все release-записи,
// включая архивные; per-user отметки прочтения не важны для истории)
router.get("/announcements/changelog", requireAuth, async (_req, res): Promise<void> => {
  const items = await db
    .select({
      id: adminAnnouncementsTable.id,
      severity: adminAnnouncementsTable.severity,
      color: adminAnnouncementsTable.color,
      title: adminAnnouncementsTable.title,
      body: adminAnnouncementsTable.body,
      publishedAt: adminAnnouncementsTable.publishedAt,
    })
    .from(adminAnnouncementsTable)
    .where(eq(adminAnnouncementsTable.kind, "release"))
    .orderBy(desc(adminAnnouncementsTable.publishedAt));

  res.json({ items });
});

// POST /announcements/:id/read — отметить прочитанным
router.post("/announcements/:id/read", requireAuth, async (req, res): Promise<void> => {
  const user = (req as AuthReq).user;
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Некорректный идентификатор оповещения" });
    return;
  }

  const [exists] = await db
    .select({ id: adminAnnouncementsTable.id })
    .from(adminAnnouncementsTable)
    .where(eq(adminAnnouncementsTable.id, id));
  if (!exists) {
    res.status(404).json({ error: "Оповещение не найдено" });
    return;
  }

  await db
    .insert(userAnnouncementReadsTable)
    .values({ userId: user.id, announcementId: id })
    .onConflictDoNothing();

  res.json({ success: true });
});

// GET /admin/announcements — история с поиском и сортировкой
router.get("/admin/announcements", requireAdmin, async (req, res): Promise<void> => {
  const search = z.string().trim().max(200).optional().parse(req.query.search || undefined);
  const kind = z.enum(["all", "announcement", "release"]).catch("all").parse(req.query.kind || "all");
  const sort = z.enum(["newest", "oldest", "title"]).catch("newest").parse(req.query.sort || "newest");

  const conditions = [];
  if (search) {
    const pattern = `%${search}%`;
    conditions.push(
      or(ilike(adminAnnouncementsTable.title, pattern), ilike(adminAnnouncementsTable.body, pattern)),
    );
  }
  if (kind !== "all") {
    conditions.push(eq(adminAnnouncementsTable.kind, kind));
  }

  const orderBy =
    sort === "oldest"
      ? asc(adminAnnouncementsTable.publishedAt)
      : sort === "title"
        ? asc(adminAnnouncementsTable.title)
        : desc(adminAnnouncementsTable.publishedAt);

  const rows = await db
    .select()
    .from(adminAnnouncementsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(orderBy);

  res.json({ items: rows });
});

// POST /admin/announcements — создать оповещение
router.post("/admin/announcements", requireAdmin, async (req, res): Promise<void> => {
  const parsed = upsertSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ошибка валидации данных", details: parsed.error.issues });
    return;
  }

  const [created] = await db.insert(adminAnnouncementsTable).values(parsed.data).returning();
  res.status(201).json(created);
});

// PATCH /admin/announcements/:id — изменить
router.patch("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Некорректный идентификатор оповещения" });
    return;
  }

  const parsed = upsertSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ошибка валидации данных", details: parsed.error.issues });
    return;
  }

  const [updated] = await db
    .update(adminAnnouncementsTable)
    .set(parsed.data)
    .where(eq(adminAnnouncementsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Оповещение не найдено" });
    return;
  }

  res.json(updated);
});

// POST /admin/announcements/:id/archive — архивировать/разархивировать
router.post("/admin/announcements/:id/archive", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Некорректный идентификатор оповещения" });
    return;
  }

  const [existing] = await db
    .select()
    .from(adminAnnouncementsTable)
    .where(eq(adminAnnouncementsTable.id, id));
  if (!existing) {
    res.status(404).json({ error: "Оповещение не найдено" });
    return;
  }

  const [updated] = await db
    .update(adminAnnouncementsTable)
    .set({ archivedAt: existing.archivedAt ? null : new Date() })
    .where(eq(adminAnnouncementsTable.id, id))
    .returning();
  res.json(updated);
});

// DELETE /admin/announcements/:id — одиночное удаление
router.delete("/admin/announcements/:id", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Некорректный идентификатор оповещения" });
    return;
  }

  const deleted = await db
    .delete(adminAnnouncementsTable)
    .where(eq(adminAnnouncementsTable.id, id))
    .returning({ id: adminAnnouncementsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Оповещение не найдено" });
    return;
  }

  res.json({ deleted: 1 });
});

// POST /admin/announcements/delete-bulk — пакетное удаление
router.post("/admin/announcements/delete-bulk", requireAdmin, async (req, res): Promise<void> => {
  const ids = z.array(z.number().int().positive()).min(1).max(500).safeParse(req.body?.ids);
  if (!ids.success) {
    res.status(400).json({ error: "Передайте от 1 до 500 корректных ID оповещений" });
    return;
  }

  const deleted = await db
    .delete(adminAnnouncementsTable)
    .where(inArray(adminAnnouncementsTable.id, ids.data))
    .returning({ id: adminAnnouncementsTable.id });
  res.json({ deleted: deleted.length });
});

// GET /admin/announcements/:id/readers — сколько пользователей прочитало
router.get("/admin/announcements/:id/readers", requireAdmin, async (req, res): Promise<void> => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Некорректный идентификатор оповещения" });
    return;
  }

  const [{ readers }] = await db
    .select({ readers: sql<number>`count(*)::int` })
    .from(userAnnouncementReadsTable)
    .where(eq(userAnnouncementReadsTable.announcementId, id));
  res.json({ readers });
});

export default router;
