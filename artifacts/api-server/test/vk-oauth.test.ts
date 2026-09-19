import assert from "node:assert/strict";
import test from "node:test";
import {
  consumeVkOAuthState,
  createVkPkceChallenge,
  readVkCallbackParams,
} from "../src/lib/vk-oauth";

test("creates the RFC 7636 S256 PKCE challenge", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

  assert.equal(
    createVkPkceChallenge(verifier),
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  );
});

test("reads VK callback query parameters", () => {
  const params = readVkCallbackParams({
    query: { code: "code-123", state: "state-123", device_id: "device-123" },
  } as never);

  assert.deepEqual(params, {
    code: "code-123",
    state: "state-123",
    deviceId: "device-123",
  });
});

test("reads VK callback parameters from a base64url payload", () => {
  const payload = Buffer.from(JSON.stringify({
    code: "code-456",
    state: "state-456",
    device_id: "device-456",
  })).toString("base64url");

  const params = readVkCallbackParams({ query: { payload } } as never);

  assert.deepEqual(params, {
    code: "code-456",
    state: "state-456",
    deviceId: "device-456",
  });
});

test("consumes VK OAuth state only once", () => {
  const session = {
    vkOAuthState: "state-123",
    vkOAuthCodeVerifier: "verifier-123",
  };

  assert.equal(consumeVkOAuthState(session, "state-123"), "verifier-123");
  assert.equal(consumeVkOAuthState(session, "state-123"), null);
});

test("rejects a mismatched VK OAuth state and clears it", () => {
  const session = {
    vkOAuthState: "expected-state",
    vkOAuthCodeVerifier: "verifier-123",
  };

  assert.equal(consumeVkOAuthState(session, "wrong-state"), null);
  assert.deepEqual(session, {});
});
