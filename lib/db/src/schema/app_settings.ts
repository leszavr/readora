import { pgTable, text, serial, boolean, integer } from "drizzle-orm/pg-core";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  value: text("value"),
});

export const ALLOW_REGISTRATION_KEY = "allowRegistration";

// Ключи для настроек режима обслуживания
export const MAINTENANCE_MODE_KEY = "maintenanceMode";
export const MAINTENANCE_REASON_KEY = "maintenanceReason";
export const MAINTENANCE_ETA_KEY = "maintenanceEta";
export const MAINTENANCE_MESSAGE_KEY = "maintenanceMessage";
