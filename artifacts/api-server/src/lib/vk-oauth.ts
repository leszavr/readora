import crypto from "node:crypto";
import type { Request } from "express";

export function createVkPkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

export function readVkCallbackParams(req: Request): { code: string; state: string; deviceId: string } {
  const payload = typeof req.query.payload === "string" ? req.query.payload : "";
  if (payload) {
    try {
      const payloadJson = payload.startsWith("{")
        ? payload
        : Buffer.from(decodeURIComponent(payload), "base64url").toString("utf8");
      const decoded = JSON.parse(payloadJson) as {
        code?: string;
        state?: string;
        device_id?: string;
      };
      return {
        code: decoded.code ?? "",
        state: decoded.state ?? "",
        deviceId: decoded.device_id ?? "",
      };
    } catch {
      return { code: "", state: "", deviceId: "" };
    }
  }

  return {
    code: typeof req.query.code === "string" ? req.query.code : "",
    state: typeof req.query.state === "string" ? req.query.state : "",
    deviceId: typeof req.query.device_id === "string" ? req.query.device_id : "",
  };
}

export function consumeVkOAuthState(
  session: { vkOAuthState?: string; vkOAuthCodeVerifier?: string },
  state: string,
): string | null {
  const expectedState = session.vkOAuthState;
  const codeVerifier = session.vkOAuthCodeVerifier;
  delete session.vkOAuthState;
  delete session.vkOAuthCodeVerifier;

  if (!state || !expectedState || state !== expectedState || !codeVerifier) return null;
  return codeVerifier;
}
