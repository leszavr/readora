export const REFERRAL_SOURCES = [
  "direct",
  "telegram",
  "habr",
  "productradar",
  "show_hn",
  "reddit",
  "vk",
  "seo",
  "other",
  "referral",
] as const;

export type ReferralSource = typeof REFERRAL_SOURCES[number];

const STORAGE_KEY = "readora.referral-source";
const REFERRAL_CODE_KEY = "readora.referral-code";
const SEARCH_HOSTS = ["google.", "yandex.", "bing.com", "duckduckgo.com", "search.brave.com"];

function normalizeSource(value: string | null): ReferralSource | null {
  if (!value) return null;

  const source = value.trim().toLowerCase();
  if (["telegram", "tg"].includes(source)) return "telegram";
  if (source === "habr") return "habr";
  if (["productradar", "product-radar"].includes(source)) return "productradar";
  if (["show_hn", "showhn", "hackernews", "hn"].includes(source)) return "show_hn";
  if (source === "reddit") return "reddit";
  if (["vk", "vkontakte"].includes(source)) return "vk";
  if (["seo", "search"].includes(source)) return "seo";
  if (source === "direct") return "direct";
  return "other";
}

function sourceFromReferrer(referrer: string): ReferralSource {
  if (!referrer) return "direct";

  try {
    const host = new URL(referrer).hostname.toLowerCase();
    if (host === location.hostname) return "direct";
    if (host === "t.me" || host.endsWith(".telegram.org")) return "telegram";
    if (host === "habr.com" || host.endsWith(".habr.com")) return "habr";
    if (host.includes("productradar")) return "productradar";
    if (host === "news.ycombinator.com" || host.endsWith(".ycombinator.com")) return "show_hn";
    if (host === "reddit.com" || host.endsWith(".reddit.com")) return "reddit";
    if (host === "vk.com" || host.endsWith(".vk.com")) return "vk";
    if (SEARCH_HOSTS.some((searchHost) => host.includes(searchHost))) return "seo";
    return "other";
  } catch {
    return "other";
  }
}

export function captureReferralSource(): ReferralSource {
  const params = new URLSearchParams(location.search);
  captureReferralCode(params.get("ref"));
  const campaignSource = normalizeSource(params.get("source") ?? params.get("utm_source"));
  const detectedSource = campaignSource ?? sourceFromReferrer(document.referrer);
  const storedSource = sessionStorage.getItem(STORAGE_KEY) as ReferralSource | null;

  if (campaignSource || (!storedSource && detectedSource !== "direct")) {
    sessionStorage.setItem(STORAGE_KEY, detectedSource);
    return detectedSource;
  }

  if (storedSource && REFERRAL_SOURCES.includes(storedSource)) return storedSource;
  sessionStorage.setItem(STORAGE_KEY, detectedSource);
  return detectedSource;
}

// Персональный код рекомендации из ссылки /?ref=<code>: живёт до регистрации.
export function captureReferralCode(ref: string | null): void {
  try {
    if (ref && /^[a-zA-Z0-9]{6}$/.test(ref)) {
      localStorage.setItem(REFERRAL_CODE_KEY, ref);
    }
  } catch {
    // Игнорируем ошибки приватного режима/квоты.
  }
}

export function getStoredReferralCode(): string | undefined {
  try {
    const code = localStorage.getItem(REFERRAL_CODE_KEY);
    return code && /^[a-zA-Z0-9]{6}$/.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

export function clearStoredReferralCode(): void {
  try {
    localStorage.removeItem(REFERRAL_CODE_KEY);
  } catch {
    // Игнорируем ошибки приватного режима/квоты.
  }
}
