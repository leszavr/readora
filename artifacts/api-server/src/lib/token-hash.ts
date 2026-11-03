import crypto from "node:crypto";

/**
 * Токены подтверждения email, сброса и смены пароля хранятся в БД
 * только в виде sha256-хэша: при утечке дампа БД неистёкшие токены
 * нельзя применить. В письмах пользователям уходят исходные значения.
 */
export function hashAuthToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
