import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encryptCredentials,
  decryptCredentials,
  isExternalStorageCryptoConfigured,
} from "../src/lib/external-storage/crypto";

const VALID_KEY = "a".repeat(64);

test("isExternalStorageCryptoConfigured reflects env key format", () => {
  process.env.EXTERNAL_STORAGE_ENCRYPTION_KEY = "short";
  assert.equal(isExternalStorageCryptoConfigured(), false);
  process.env.EXTERNAL_STORAGE_ENCRYPTION_KEY = VALID_KEY;
  assert.equal(isExternalStorageCryptoConfigured(), true);
  delete process.env.EXTERNAL_STORAGE_ENCRYPTION_KEY;
  assert.equal(isExternalStorageCryptoConfigured(), false);
});

test("encryptCredentials/decryptCredentials roundtrip", () => {
  process.env.EXTERNAL_STORAGE_ENCRYPTION_KEY = VALID_KEY;
  const payload = { provider: "mail_ru_cloud", login: "user@mail.ru", appPassword: "secret-пароль" };
  const blob = encryptCredentials(payload);
  assert.notEqual(blob, JSON.stringify(payload));
  assert.ok(!blob.includes("secret"));
  assert.deepEqual(decryptCredentials<typeof payload>(blob), payload);
});

test("decryptCredentials rejects tampered blob", () => {
  process.env.EXTERNAL_STORAGE_ENCRYPTION_KEY = VALID_KEY;
  const blob = encryptCredentials({ provider: "mail_ru_cloud", login: "a", appPassword: "b" });
  const parts = blob.split(".");
  const data = Buffer.from(parts[3], "base64url");
  data[0] ^= 0xff;
  parts[3] = data.toString("base64url");
  assert.throws(() => decryptCredentials(parts.join(".")));
});

test("decryptCredentials rejects blob encrypted with another key", () => {
  process.env.EXTERNAL_STORAGE_ENCRYPTION_KEY = VALID_KEY;
  const blob = encryptCredentials({ provider: "mail_ru_cloud", login: "a", appPassword: "b" });
  process.env.EXTERNAL_STORAGE_ENCRYPTION_KEY = "b".repeat(64);
  assert.throws(() => decryptCredentials(blob));
});

test("decryptCredentials rejects malformed blob", () => {
  process.env.EXTERNAL_STORAGE_ENCRYPTION_KEY = VALID_KEY;
  assert.throws(() => decryptCredentials("v2.a.b.c"));
  assert.throws(() => decryptCredentials("garbage"));
});
