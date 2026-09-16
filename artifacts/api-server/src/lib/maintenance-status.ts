import {
  appSettingsTable,
  db,
  MAINTENANCE_ETA_KEY,
  MAINTENANCE_MESSAGE_KEY,
  MAINTENANCE_MODE_KEY,
  MAINTENANCE_REASON_KEY,
} from "@workspace/db";

export type MaintenanceStatus = {
  enabled: boolean;
  reason: string | null;
  eta: string | null;
  message: string | null;
};

export async function getMaintenanceStatus(): Promise<MaintenanceStatus> {
  const rows = await db.select().from(appSettingsTable);
  const settings = new Map(rows.map(({ key, value }) => [key, value]));

  return {
    enabled: settings.get(MAINTENANCE_MODE_KEY) === "true",
    reason: settings.get(MAINTENANCE_REASON_KEY) ?? null,
    eta: settings.get(MAINTENANCE_ETA_KEY) ?? null,
    message: settings.get(MAINTENANCE_MESSAGE_KEY) ?? null,
  };
}
