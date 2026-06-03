import { Router } from "express";
import { eq, sql } from "drizzle-orm";
import { appSettingsTable, db } from "@workspace/db";
import { requireAdmin } from "../middlewares/auth";

const router = Router();
const PWA_INSTALL_ACCEPTED_KEY = "pwa_install_accepted_count";

// POST /pwa/install-accepted
router.post("/pwa/install-accepted", async (_req, res): Promise<void> => {
  await db.execute(sql`
    insert into app_settings ("key", "value")
    values (${PWA_INSTALL_ACCEPTED_KEY}, '1')
    on conflict ("key")
    do update set "value" = (coalesce(app_settings."value", '0')::int + 1)::text
  `);

  res.sendStatus(204);
});

// GET /admin/pwa-stats
router.get("/admin/pwa-stats", requireAdmin, async (_req, res): Promise<void> => {
  const [row] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, PWA_INSTALL_ACCEPTED_KEY))
    .limit(1);

  const acceptedCount = Number.parseInt(row?.value ?? "0", 10);

  res.json({
    acceptedCount: Number.isFinite(acceptedCount) ? acceptedCount : 0,
  });
});

export default router;
