import { ALLOW_REGISTRATION_KEY, appSettingsTable, db } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function isRegistrationEnabled(): Promise<boolean> {
  const [setting] = await db
    .select({ value: appSettingsTable.value })
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, ALLOW_REGISTRATION_KEY));

  return setting?.value !== "false";
}
