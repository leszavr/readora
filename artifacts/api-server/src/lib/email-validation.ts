import { promises as dns } from "node:dns";
import { domainToASCII } from "node:url";
import { logger } from "./logger";

// Зарезервированные IANA домены/TLD — заведомо не принимают почту
const BLOCKED_DOMAINS = new Set(["example.com", "example.org", "example.net", "example.edu"]);
const BLOCKED_TLDS = [".test", ".example", ".invalid", ".localhost"];

// Популярные провайдеры — для подсказок опечаток
export const KNOWN_EMAIL_DOMAINS = [
  "gmail.com", "googlemail.com", "mail.ru", "mail.com", "bk.ru", "inbox.ru",
  "list.ru", "yandex.ru", "ya.ru", "yandex.com", "rambler.ru", "outlook.com",
  "hotmail.com", "live.com", "icloud.com", "me.com", "yahoo.com", "proton.me", "protonmail.com",
];

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** Чистая функция без node-зависимостей — аналог живёт на клиенте в readora/src/lib/email-typo.ts */
export function suggestEmailTypo(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (KNOWN_EMAIL_DOMAINS.includes(domain)) return null;

  // Совпал бренд, но не TLD: gmail.ru → gmail.com
  const brand = domain.split(".")[0];
  const byBrand = KNOWN_EMAIL_DOMAINS.find((d) => d.split(".")[0] === brand);
  if (byBrand) return `${local}@${byBrand}`;

  // Опечатка в имени: gmai.com → gmail.com (расстояние Левенштейна ≤ 2)
  let best: string | null = null;
  let bestDist = 3;
  for (const d of KNOWN_EMAIL_DOMAINS) {
    const dist = editDistance(domain, d);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best ? `${local}@${best}` : null;
}

type MxStatus = "ok" | "no-mail" | "unknown";
const mxCache = new Map<string, { status: MxStatus; until: number }>();
const MX_TTL_MS: Record<MxStatus, number> = { ok: 86_400_000, "no-mail": 600_000, unknown: 30_000 };

const DNS_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error("DNS timeout"), { code: "ETIMEDOUT" })),
      ms,
    );
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export async function getMxStatus(domain: string): Promise<MxStatus> {
  const ascii = domainToASCII(domain);
  if (!ascii) return "no-mail";
  const cached = mxCache.get(ascii);
  if (cached && cached.until > Date.now()) return cached.status;

  let status: MxStatus;
  try {
    const records = await withTimeout(dns.resolveMx(ascii), DNS_TIMEOUT_MS);
    // RFC 7505 (Null MX): "0 ." — домен явно не принимает почту (example.com)
    status = records.some((r) => r.exchange && r.exchange !== ".") ? "ok" : "no-mail";
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOTFOUND" || code === "ENODATA") {
      status = "no-mail";
    } else {
      // Таймаут/SERVFAIL резолвера — не наказываем легитимного пользователя
      status = "unknown";
      logger.warn({ err: error, domain: ascii }, "MX lookup failed, allowing registration");
    }
  }
  if (mxCache.size > 10_000) mxCache.clear();
  mxCache.set(ascii, { status, until: Date.now() + MX_TTL_MS[status] });
  return status;
}

export type EmailCheckResult = { ok: true } | { ok: false; message: string };

export function clearMxCache(): void {
  mxCache.clear();
}

export async function checkRegistrationEmail(email: string): Promise<EmailCheckResult> {
  if (email.length > 254) return { ok: false, message: "Слишком длинный email" };
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const suggestion = suggestEmailTypo(email);
  const hint = suggestion ? ` Возможно, вы имели в виду ${suggestion}?` : "";

  if (BLOCKED_DOMAINS.has(domain) || BLOCKED_TLDS.some((t) => domain.endsWith(t))) {
    return { ok: false, message: `Этот домен не принимает почту.${hint}` };
  }
  if ((await getMxStatus(domain)) === "no-mail") {
    return { ok: false, message: `Домен ${domain} не принимает почту. Проверьте адрес.${hint}` };
  }
  return { ok: true };
}
