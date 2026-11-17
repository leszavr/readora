// Популярные провайдеры — для подсказок опечаток.
// Список синхронизирован с серверным artifacts/api-server/src/lib/email-validation.ts
const KNOWN_DOMAINS = [
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

export function suggestEmailTypo(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (KNOWN_DOMAINS.includes(domain)) return null;

  // Совпал бренд, но не TLD: gmail.ru → gmail.com
  const brand = domain.split(".")[0];
  const byBrand = KNOWN_DOMAINS.find((d) => d.split(".")[0] === brand);
  if (byBrand) return `${local}@${byBrand}`;

  // Опечатка в имени: gmai.com → gmail.com (расстояние Левенштейна ≤ 2)
  let best: string | null = null;
  let bestDist = 3;
  for (const d of KNOWN_DOMAINS) {
    const dist = editDistance(domain, d);
    if (dist < bestDist) {
      bestDist = dist;
      best = d;
    }
  }
  return best ? `${local}@${best}` : null;
}
