import assert from "node:assert/strict";
import test from "node:test";
import { mock } from "node:test";
import { promises as dns } from "node:dns";
import {
  checkRegistrationEmail,
  clearMxCache,
  suggestEmailTypo,
} from "../src/lib/email-validation";

function mockResolveMx(impl: (domain: string) => Promise<{ exchange: string; priority: number }[]>) {
  return mock.method(dns, "resolveMx", impl);
}

test("suggestEmailTypo подсказывает по бренду и опечатке", () => {
  assert.equal(suggestEmailTypo("ivan@gmail.ru"), "ivan@gmail.com");
  assert.equal(suggestEmailTypo("ivan@gmai.com"), "ivan@gmail.com");
  assert.equal(suggestEmailTypo("ivan@outlook.ru"), "ivan@outlook.com");
  assert.equal(suggestEmailTypo("ivan@gmail.com"), null);
  assert.equal(suggestEmailTypo("ivan@some-unknown-domain.io"), null);
});

test("блокирует зарезервированные домены без DNS-запроса", async () => {
  const dnsMock = mockResolveMx(async () => {
    throw new Error("не должен вызываться");
  });
  clearMxCache();

  const result = await checkRegistrationEmail("ivan@example.com");
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /не принимает почту/);

  dnsMock.mock.restore();
});

test("блокирует домен без MX (gmail.ru)", async () => {
  const dnsMock = mockResolveMx(async () => {
    const err = new Error("queryA ENOTFOUND") as NodeJS.ErrnoException;
    err.code = "ENOTFOUND";
    throw err;
  });
  clearMxCache();

  const result = await checkRegistrationEmail("ivan@gmail.ru");
  assert.equal(result.ok, false);
  assert.match((result as { message: string }).message, /gmail\.ru не принимает почту/);
  assert.match((result as { message: string }).message, /ivan@gmail\.com/);

  dnsMock.mock.restore();
});

test("блокирует Null MX по RFC 7505 (example.org)", async () => {
  const dnsMock = mockResolveMx(async () => [{ exchange: ".", priority: 0 }]);
  clearMxCache();

  const result = await checkRegistrationEmail("ivan@some-null-mx.org");
  assert.equal(result.ok, false);

  dnsMock.mock.restore();
});

test("пропускает домен с живым MX", async () => {
  const dnsMock = mockResolveMx(async () => [{ exchange: "emx.mail.ru.", priority: 10 }]);
  clearMxCache();

  const result = await checkRegistrationEmail("ivan@outlook.ru");
  assert.deepEqual(result, { ok: true });

  dnsMock.mock.restore();
});

test("пропускает при таймауте DNS (fail-open)", async () => {
  const dnsMock = mockResolveMx(async () => {
    const err = new Error("timeout") as NodeJS.ErrnoException;
    err.code = "ETIMEDOUT";
    throw err;
  });
  clearMxCache();

  const result = await checkRegistrationEmail("ivan@gmail.com");
  assert.deepEqual(result, { ok: true });

  dnsMock.mock.restore();
});
