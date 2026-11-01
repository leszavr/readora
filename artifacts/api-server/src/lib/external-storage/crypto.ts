import crypto from "node:crypto";

// Шифрование кредов внешних хранилищ (AES-256-GCM). Ключ задаётся в
// EXTERNAL_STORAGE_ENCRYPTION_KEY (64 hex-символа, 32 байта) и никогда не
// попадает в БД, логи или ответы API.

const KEY_ENV = "EXTERNAL_STORAGE_ENCRYPTION_KEY";

function getKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw || !/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error("EXTERNAL_STORAGE_ENCRYPTION_KEY must be set (64 hex chars)");
  }
  return Buffer.from(raw, "hex");
}

export function isExternalStorageCryptoConfigured(): boolean {
  const raw = process.env[KEY_ENV];
  return !!raw && /^[0-9a-fA-F]{64}$/.test(raw);
}

export function encryptCredentials(payload: unknown): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getKey(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decryptCredentials<T>(blob: string): T {
  const [version, ivPart, tagPart, dataPart] = blob.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !dataPart) {
    throw new Error("Invalid encrypted credentials");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  const data = Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]);
  return JSON.parse(data.toString("utf8")) as T;
}
