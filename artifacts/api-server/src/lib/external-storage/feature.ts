import { eq } from "drizzle-orm";
import { appSettingsTable, db } from "@workspace/db";

// Глобальный признак включённости внешних хранилищ (админка). По умолчанию
// включены: ключ отсутствует или не "false".

export const EXTERNAL_STORAGE_ENABLED_KEY = "externalStorageEnabled";

export async function isExternalStorageEnabled(): Promise<boolean> {
  const [row] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, EXTERNAL_STORAGE_ENABLED_KEY));
  return row?.value !== "false";
}

export function externalStorageDisabledMessage(): string {
  return "Доступ к внешним хранилищам отключён администратором";
}
