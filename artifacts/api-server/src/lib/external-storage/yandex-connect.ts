import { and, eq } from "drizzle-orm";
import { db, externalStorageConnectionsTable } from "@workspace/db";
import { encryptCredentials } from "./crypto";
import { listExternalFolder, ExternalStorageError, type ExternalCredentials } from "./drivers";

// Завершение OAuth-подключения Яндекс.Диска: обмен кода на токен (в том же
// виде, что и вход через Яндекс), проверка доступа к Диску, сохранение
// подключения. Использует общий с входом Callback URL — в приложении Яндекса
// зарегистрирован один redirect_uri.

const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";

function getYandexEnv(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export async function completeYandexDiskConnect(userId: number, code: string): Promise<void> {
  const env = getYandexEnv();
  if (!env) {
    throw new ExternalStorageError("auth", "Подключение Яндекс.Диска не настроено на сервере");
  }

  const tokenRes = await fetch(YANDEX_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${env.clientId}:${env.clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const tokenData = (await tokenRes.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  } | null;
  if (!tokenRes.ok || !tokenData?.access_token) {
    throw new ExternalStorageError("auth", "Яндекс не выдал токен доступа к Диску");
  }

  const credentials: ExternalCredentials = {
    provider: "yandex_disk",
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token,
    expiresAt: new Date(Date.now() + (tokenData.expires_in ?? 31_536_000) * 1000).toISOString(),
  };
  await listExternalFolder(credentials, "/");

  const encrypted = encryptCredentials(credentials);
  const [existing] = await db
    .select({ id: externalStorageConnectionsTable.id })
    .from(externalStorageConnectionsTable)
    .where(and(
      eq(externalStorageConnectionsTable.ownerUserId, userId),
      eq(externalStorageConnectionsTable.provider, "yandex_disk"),
    ));

  if (existing) {
    await db
      .update(externalStorageConnectionsTable)
      .set({ credentialsEncrypted: encrypted, status: "active", lastError: null })
      .where(eq(externalStorageConnectionsTable.id, existing.id));
  } else {
    await db
      .insert(externalStorageConnectionsTable)
      .values({ ownerUserId: userId, provider: "yandex_disk", credentialsEncrypted: encrypted });
  }
}
