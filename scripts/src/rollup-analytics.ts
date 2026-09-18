import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

function loadRootEnvFile(): void {
  if (process.env.DATABASE_URL) return;

  const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
  const envPath = resolve(scriptDirectory, "../..", ".env");
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

function getTargetDate(): string {
  const supplied = process.argv.slice(2).find((argument) => argument !== "--");
  if (supplied) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(supplied) || Number.isNaN(Date.parse(`${supplied}T00:00:00Z`))) {
      throw new Error("Передайте дату в формате YYYY-MM-DD");
    }
    return supplied;
  }

  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return yesterday.toISOString().slice(0, 10);
}

loadRootEnvFile();

const activityDate = getTargetDate();
const { rollupAnalyticsDay } = await import("@workspace/db/analytics-rollup");
const result = await rollupAnalyticsDay(activityDate);

if (result.skipped) {
  console.log("Analytics rollup skipped because another instance is running");
} else {
  console.log(`Analytics rollup completed for ${activityDate}; expired events deleted: ${result.retentionDeleted}`);
}
