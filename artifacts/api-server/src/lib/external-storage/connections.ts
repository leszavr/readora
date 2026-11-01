import { and, eq } from "drizzle-orm";
import { db, externalStorageConnectionsTable, type ExternalStorageConnection } from "@workspace/db";
import { decryptCredentials, encryptCredentials } from "./crypto";
import { ExternalStorageError, type ExternalCredentials, type YandexDiskCredentials } from "./drivers";

// Сервис подключений: владелец, расшифровка кредов, обновление статуса.
// Ошибки авторизации отмечаются в status, чтобы UI и админка их видели.

const YANDEX_TOKEN_URL = "https://oauth.yandex.ru/token";
const YANDEX_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export async function getOwnedConnection(userId: number, connectionId: number): Promise<ExternalStorageConnection | null> {
  const [connection] = await db
    .select()
    .from(externalStorageConnectionsTable)
    .where(and(eq(externalStorageConnectionsTable.id, connectionId), eq(externalStorageConnectionsTable.ownerUserId, userId)));
  return connection ?? null;
}

async function refreshYandexToken(credentials: YandexDiskCredentials): Promise<YandexDiskCredentials> {
  if (!credentials.refreshToken) {
    throw new ExternalStorageError("auth", "Яндекс.Диск: токен истёк, повторите подключение");
  }
  const clientId = process.env.YANDEX_CLIENT_ID;
  const clientSecret = process.env.YANDEX_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ExternalStorageError("auth", "Яндекс OAuth не настроен на сервере");
  }
  const res = await fetch(YANDEX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: credentials.refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new ExternalStorageError("auth", "Яндекс.Диск: не удалось обновить токен, повторите подключение");
  }
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new ExternalStorageError("auth", "Яндекс.Диск: пустой токен при обновлении");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? credentials.refreshToken,
    expiresAt: new Date(Date.now() + (data.expires_in ?? 31_536_000) * 1000).toISOString(),
  };
}

async function resolveCredentials(connection: ExternalStorageConnection): Promise<ExternalCredentials> {
  const credentials = decryptCredentials<ExternalCredentials>(connection.credentialsEncrypted);
  if (credentials.provider !== "yandex_disk") return credentials;

  if (credentials.expiresAt && new Date(credentials.expiresAt).getTime() - Date.now() < YANDEX_REFRESH_MARGIN_MS) {
    const refreshed = await refreshYandexToken(credentials);
    await db
      .update(externalStorageConnectionsTable)
      .set({ credentialsEncrypted: encryptCredentials(refreshed), status: "active", lastError: null })
      .where(eq(externalStorageConnectionsTable.id, connection.id));
    return { provider: "yandex_disk", ...refreshed };
  }
  return credentials;
}

// Расшифровывает креды подключения (для Яндекс.Диска — при необходимости
// обновляет токен) и возвращает вместе с актуальной версией подключения.
export async function loadConnectionCredentials(
  connection: ExternalStorageConnection,
): Promise<{ connection: ExternalStorageConnection; credentials: ExternalCredentials }> {
  const credentials = await resolveCredentials(connection);
  return { connection, credentials };
}

export async function markConnectionStatus(
  connectionId: number,
  status: "active" | "auth_error" | "error",
  errorMessage: string | null,
): Promise<void> {
  await db
    .update(externalStorageConnectionsTable)
    .set({ status, lastError: errorMessage })
    .where(eq(externalStorageConnectionsTable.id, connectionId));
}
