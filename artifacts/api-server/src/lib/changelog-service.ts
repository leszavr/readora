import { desc, eq } from "drizzle-orm";
import { adminAnnouncementsTable, db } from "@workspace/db";

export async function getChangelogEntries() {
  const rows = await db
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
  return rows as ChangelogEntryRow[];
}

export type ChangelogEntryRow = {
  id: number;
  severity: "info" | "warning";
  color: "yellow" | "green" | "blue" | "pink" | "purple";
  title: string;
  body: string;
  publishedAt: Date;
};
