/**
 * E2E-диагностика бага «белый экран» при выходе из ридера на страницу книги
 * после продолжительного чтения.
 *
 * Сценарий: логин → ридер → «чтение» (скролл нескольких глав, паузы,
 * имитация долгой сессии, при желании — переход по заметке/закладке) →
 * клик по стрелке «на страницу книги» → проверка рендера BookPage.
 *
 * Собирает: pageerror (необработанные исключения), console.error/warn,
 * сетевые ошибки/5xx, дамп localStorage и sessionStorage после каждой фазы.
 * Результат — JSON-отчёт в .tmp/e2e-reader-exit-report.json.
 *
 * Запуск (dev-инстанс):
 *   pnpm --filter @workspace/scripts exec tsx src/e2e-reader-exit.ts
 * Переменные: E2E_BASE_URL (по умолчанию http://localhost:3000),
 *   E2E_LONG_READ_MS (по умолчанию 60000) — длительность «чтения».
 */
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = "reader.e2e@test.local";
const TEST_PASSWORD = "E2eReader#2026";
const LONG_READ_MS = Number(process.env.E2E_LONG_READ_MS ?? 60_000);

const chromiumPath = path.join(
  homedir(),
  ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
);

interface LogEntry {
  time: string;
  kind: "pageerror" | "console" | "requestfailed" | "response";
  detail: string;
  at?: string;
}

interface PhaseResult {
  phase: string;
  ok: boolean;
  url: string;
  note?: string;
}

interface Report {
  startedAt: string;
  baseUrl: string;
  longReadMs: number;
  logs: LogEntry[];
  phases: PhaseResult[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
  domAfterExit: { rootChildCount: number; bodyTextSample: string } | null;
  verdict: string;
}

function loadSeededBookIds(): Record<number, number> {
  try {
    const file = path.join(process.cwd(), ".tmp", "e2e-book-ids.json");
    const parsed = JSON.parse(readFileSync(file, "utf8")) as { books?: Record<string, number> };
    if (parsed?.books) {
      return Object.fromEntries(
        Object.entries(parsed.books).map(([o, n]) => [Number(o), n]),
      );
    }
  } catch {
    // фолбэк ниже
  }
  return { 31: 141, 32: 142, 33: 143, 1: 139, 7: 140 };
}

async function login(page: import("playwright-core").Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
  await page.fill('input[placeholder="••••••••"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/library/, { timeout: 20000 });
}

async function dumpStorage(page: import("playwright-core").Page): Promise<{
  local: Record<string, string>;
  session: Record<string, string>;
}> {
  return page.evaluate(() => {
    const local: Record<string, string> = {};
    const session: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      local[k] = localStorage.getItem(k) ?? "";
    }
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!;
      session[k] = sessionStorage.getItem(k) ?? "";
    }
    return { local, session };
  });
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();

  const logs: LogEntry[] = [];
  const phases: PhaseResult[] = [];
  const stamp = () => new Date().toISOString();
  page.on("pageerror", (err) => {
    logs.push({ time: stamp(), kind: "pageerror", detail: String(err), at: (err as Error).stack?.split("\n").slice(0, 6).join(" | ") });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      logs.push({ time: stamp(), kind: "console", detail: `[${msg.type()}] ${msg.text().slice(0, 500)}` });
    }
  });
  page.on("requestfailed", (req) => {
    logs.push({ time: stamp(), kind: "requestfailed", detail: `${req.method()} ${req.url()} — ${req.failure()?.errorText}` });
  });
  page.on("response", (res) => {
    if (res.status() >= 500) {
      logs.push({ time: stamp(), kind: "response", detail: `${res.status()} ${res.url()}` });
    }
  });

  const seeded = loadSeededBookIds();
  const bookId = seeded[31] ?? 141;

  let domAfterExit: Report["domAfterExit"] = null;
  let localStorageDump: Record<string, string> = {};
  let sessionStorageDump: Record<string, string> = {};

  try {
    await login(page);
    phases.push({ phase: "login", ok: true, url: page.url() });

    // --- Фаза: открыть ридер и дождаться контента
    await page.goto(`${BASE_URL}/reader/${bookId}`);
    await page.waitForSelector(".reader-content-area", { timeout: 20000 });
    phases.push({ phase: "open reader", ok: true, url: page.url() });

    // --- Фаза: «продолжительное чтение»
    // Скроллим с паузами (процессинг прогресса, periodic save, analytics
    // heartbeats), между порциями — переходы по главам кнопками next/prev.
    const readDeadline = Date.now() + LONG_READ_MS;
    let scrolls = 0;
    while (Date.now() < readDeadline) {
      await page.evaluate(() => {
        const c = document.querySelector(".reader-content-area")?.parentElement;
        if (c) c.scrollTop += Math.round(c.clientHeight * 0.8);
      });
      scrolls += 1;
      await page.waitForTimeout(1500);
      // Каждые ~6 скроллов — переход на следующую главу (кнопка вправо в шапке/футере)
      if (scrolls % 6 === 0) {
        const nextBtn = page.locator('button[aria-label*="ледующ"], button:has(.lucide-chevron-right)').last();
        if (await nextBtn.count()) {
          await nextBtn.click().catch(() => undefined);
          await page.waitForTimeout(1200);
        }
      }
    }
    phases.push({ phase: `long read (${Math.round(LONG_READ_MS / 1000)}s, ${scrolls} scrolls)`, ok: true, url: page.url() });

    // Опционально: открыть панель закладок и прыгнуть по закладке той же книги
    // (воспроизводит jump-hold и pendingNoteHighlight — главные подозреваемые).
    // E2E_QUICK_EXIT=1 — выход сразу после прыжка, пока 450ms-таймер подсветки
    // ещё_pending (поздние таймеры на размонтированном DOM).
    const quickExit = process.env.E2E_QUICK_EXIT === "1";
    try {
      const bmBtn = page.locator('button[aria-label="Закладки"]');
      if (await bmBtn.count()) {
        await bmBtn.click();
        await page.waitForTimeout(500);
        // Кликабельная строка закладки той же книги (кнопка .flex-1 внутри панели «Закладки»)
        const bmItem = page.locator("div.fixed h2:text('Закладки') ~ * button.flex-1, div.fixed button.flex-1.text-left").first();
        if (await bmItem.count()) {
          await bmItem.click({ timeout: 3000 });
          await page.waitForTimeout(quickExit ? 200 : 1500);
          phases.push({ phase: `jump to bookmark${quickExit ? " + quick exit" : ""}`, ok: true, url: page.url() });
        } else {
          phases.push({ phase: "jump to bookmark", ok: false, url: page.url(), note: "закладки не найдены — нужен e2e-seed" });
        }
      }
    } catch (e) {
      phases.push({ phase: "jump to bookmark", ok: false, url: page.url(), note: String(e).slice(0, 120) });
    }

    // Дамп storage до выхода — важно поймать состояние до возможного краха
    const pre = await dumpStorage(page);
    localStorageDump = pre.local;
    sessionStorageDump = pre.session;

    // --- Фаза: выход на страницу книги по стрелке в шапке ридера
    // bookId берём из текущего URL: прыжок по закладке мог сменить книгу цикла
    const currentBookId = Number(/\/reader\/(\d+)/.exec(page.url())?.[1] ?? bookId);
    const backLink = page.locator(`a[href="/book/${currentBookId}"]`).first();
    await backLink.click({ timeout: 5000 });
    await page.waitForTimeout(4000); // даём отработать поздним таймерам (450ms highlight, 2s retry)

    const url = page.url();
    const dom = await page.evaluate(() => {
      const root = document.getElementById("root");
      return {
        rootChildCount: root ? root.childElementCount : -1,
        bodyTextSample: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
      };
    });
    domAfterExit = dom;
    const whiteScreen =
      !/\/book\/\d+/.test(url) || dom.rootChildCount === 0 || dom.bodyTextSample.trim().length < 20;
    phases.push({
      phase: "exit to book page",
      ok: !whiteScreen,
      url,
      note: whiteScreen ? "БЕЛЫЙ ЭКРАН: root пуст или текста нет" : "страница книги отрендерилась",
    });

    // Финальный дамп storage (после потенциального краша)
    const post = await dumpStorage(page).catch(() => ({ local: {}, session: {} }));
    for (const [k, v] of Object.entries(post.local)) if (!(k in localStorageDump)) localStorageDump[`${k} (after)`] = v;
    for (const [k, v] of Object.entries(post.session)) if (!(k in sessionStorageDump)) sessionStorageDump[`${k} (after)`] = v;
  } catch (error) {
    phases.push({ phase: "fatal", ok: false, url: page.url(), note: String(error).slice(0, 300) });
  } finally {
    const pageErrors = logs.filter((l) => l.kind === "pageerror");
    const exitOk = phases.find((p) => p.phase === "exit to book page")?.ok ?? false;
    const verdict = !exitOk
      ? pageErrors.length > 0
        ? `БАГ ВОСПРОИЗВЕДЁН: белый экран + ${pageErrors.length} pageerror (см. logs)`
        : "БАГ ВОСПРОИЗВЕДЁН: белый экран без pageerror (смотреть console/сеть)"
      : pageErrors.length > 0
        ? `Экран ок, но есть ${pageErrors.length} pageerror — возможно, невоспроизведённый сценарий`
        : "Сценарий прошёл чисто";

    const report: Report = {
      startedAt: stamp(),
      baseUrl: BASE_URL,
      longReadMs: LONG_READ_MS,
      logs,
      phases,
      localStorage: localStorageDump,
      sessionStorage: sessionStorageDump,
      domAfterExit,
      verdict,
    };

    const outDir = path.join(process.cwd(), ".tmp");
    mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "e2e-reader-exit-report.json");
    writeFileSync(outFile, JSON.stringify(report, null, 2), "utf8");

    console.log("\n=== Фазы ===");
    for (const p of phases) console.log(`${p.ok ? "OK  " : "FAIL"} ${p.phase}${p.note ? ` — ${p.note}` : ""}`);
    console.log(`\n=== Вердикт: ${verdict}`);
    console.log(`Логи (${logs.length}), отчёт: ${outFile}`);

    await browser.close();
    process.exit(exitOk ? 0 : 2);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
