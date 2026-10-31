/**
 * E2E-проверка переходов по заметкам/закладкам:
 *  - из библиотеки (вкладка «Заметки и закладки») — заметки и закладки;
 *  - межцикловое отображение и переход в ридере;
 *  - переход по заметке той же книги в ридере.
 * Для каждого перехода проверяется: открытие нужной книги, подсветка текста
 * и нахождение выделенного фрагмента в видимой области экрана.
 *
 * Запуск: pnpm --filter @workspace/scripts exec tsx src/e2e-run.ts
 */
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = "reader.e2e@test.local";
const TEST_PASSWORD = "E2eReader#2026";
const CYCLE_BOOK_A = 126; // На струне (цикл)
const SAMPLE_PER_PHASE = 12;

const chromiumPath = path.join(
  homedir(),
  ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
);

interface CheckResult {
  ok: boolean;
  overlayCount?: number;
  overlayInViewport?: boolean;
  textFound?: boolean;
  textRectInViewport?: boolean | null;
  overlayTouchesText?: boolean | null;
}

interface CaseResult {
  phase: string;
  item: string;
  bookId?: string;
  url?: string;
  checks?: CheckResult;
  error?: string;
  pass: boolean;
}

function verdict(checks: CheckResult | undefined, url: string, expectedBookId: string | null): boolean {
  if (!checks) return false;
  const urlOk = expectedBookId ? url.includes(`/reader/${expectedBookId}`) : /\/reader\/\d+/.test(url);
  return (
    urlOk &&
    (checks.overlayCount ?? 0) > 0 &&
    checks.overlayInViewport === true &&
    checks.textFound === true &&
    checks.textRectInViewport === true &&
    checks.overlayTouchesText !== false
  );
}

/** Проверка подсветки в контексте страницы: оверлеи + прямоугольники искомого текста.
 *  Функция передаётся строкой: tsx/esbuild добавляет __name-хелперы, которые ломают сериализацию. */
async function checkHighlight(page: import("playwright-core").Page, expectedText: string): Promise<CheckResult> {
  const body = `(targetRaw) => {
    const overlays = Array.from(document.querySelectorAll(".readora-note-highlight-overlay")).map((el) => el.getBoundingClientRect());
    const vh = window.innerHeight;
    const area = document.querySelector(".reader-content-area");
    const normalize = (s) => s.replace(/\\s+/g, " ").trim();
    const targetNorm = normalize(targetRaw);
    let textFound = false;
    let textRects = [];
    if (area) {
      const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      const nodes = [];
      const starts = [];
      let raw = "";
      let n;
      while ((n = walker.nextNode())) {
        starts.push(raw.length);
        raw += n.textContent || "";
        nodes.push(n);
      }
      let norm = "";
      const rawIndexOf = [];
      let prevSpace = true;
      for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (/\\s/.test(ch)) {
          if (!prevSpace) { norm += " "; rawIndexOf.push(i); prevSpace = true; }
        } else {
          norm += ch; rawIndexOf.push(i); prevSpace = false;
        }
      }
      if (norm.endsWith(" ")) { norm = norm.slice(0, -1); rawIndexOf.pop(); }
      const normIdx = norm.indexOf(targetNorm);
      if (normIdx >= 0 && rawIndexOf.length > 0) {
        textFound = true;
        const rawStart = rawIndexOf[normIdx] || 0;
        const rawEnd = rawIndexOf[Math.min(normIdx + targetNorm.length - 1, rawIndexOf.length - 1)] || rawStart;
        const findPos = (offset) => {
          let lo = 0, hi = nodes.length - 1;
          while (lo <= hi) {
            const mid = (lo + hi) >> 1;
            const start = starts[mid];
            const end = start + (nodes[mid].textContent ? nodes[mid].textContent.length : 0);
            if (offset < start) { hi = mid - 1; }
            else if (offset >= end) { lo = mid + 1; }
            else { return { node: nodes[mid], offset: offset - start }; }
          }
          const last = nodes.length - 1;
          return last >= 0 ? { node: nodes[last], offset: nodes[last].textContent ? nodes[last].textContent.length : 0 } : null;
        };
        const sp = findPos(rawStart);
        const ep = findPos(rawEnd + 1);
        if (sp && ep) {
          const range = document.createRange();
          range.setStart(sp.node, sp.offset);
          range.setEnd(ep.node, ep.offset);
          textRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        }
      }
    }
    const inViewport = (r) => r.top >= -8 && r.bottom <= vh + 8 && r.height > 0;
    const intersects = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    return {
      overlayCount: overlays.length,
      overlayInViewport: overlays.length > 0 && overlays.some(inViewport),
      textFound: textFound,
      textRectInViewport: textRects.length > 0 ? textRects.some(inViewport) : null,
      overlayTouchesText: textRects.length > 0 && overlays.length > 0
        ? overlays.some((o) => textRects.some((r) => intersects(o, r)))
        : null,
    };
  }`;
  // Строка-функция не вызывается playwright с аргументом — оборачиваем в вызов-выражение
  return page.evaluate(`(${body})(${JSON.stringify(expectedText)})`);
}

async function extractQuote(el: import("playwright-core").Locator): Promise<string> {
  const text = await el.innerText();
  // последний фрагмент в «...» — цитата карточки (noteText/label идут раньше)
  const matches = text.match(/«([^»]+)»/g);
  if (!matches || matches.length === 0) return "";
  return matches[matches.length - 1]!.slice(1, -1);
}

async function login(page: import("playwright-core").Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
  await page.fill('input[placeholder="••••••••"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/library/, { timeout: 20000 });
}

/** Открыть вкладку «Заметки и закладки» в библиотеке, вернуть карточки */
async function openLibraryTab(page: import("playwright-core").Page): Promise<import("playwright-core").Locator[]> {
  await page.goto(`${BASE_URL}/library`);
  await page.waitForLoadState("networkidle");
  await page.click('button:has-text("Заметки и закладки")');
  await page.waitForSelector('a[href^="/reader/"]', { timeout: 10000 });
  return page.locator('a[href^="/reader/"]').all();
}

async function run(): Promise<void> {
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  const results: CaseResult[] = [];

  try {
    await login(page);
    console.log("Вход выполнен, начинаем проверки...");

    // ---------------------------------------------------------------
    // Фаза 1: заметки из библиотеки
    // ---------------------------------------------------------------
    {
      await openLibraryTab(page);
      const cards = page.locator('a[href^="/reader/"]');
      const total = await cards.count();
      const texts = await cards.allInnerTexts();
      const v1Idx = texts.map((t, i) => (t.includes("(v1)") ? i : -1)).filter((i) => i >= 0);
      const v2Idx = texts.map((t, i) => (!t.includes("(v1)") ? i : -1)).filter((i) => i >= 0);
      const sample = [
        ...v1Idx.slice(0, SAMPLE_PER_PHASE / 2),
        ...v2Idx.slice(0, SAMPLE_PER_PHASE / 2),
      ].slice(0, SAMPLE_PER_PHASE);

      for (const idx of sample) {
        const card = cards.nth(idx);
        const label = (texts[idx] ?? "").split("\n")[0]?.slice(0, 60) ?? `карточка #${idx}`;
        const expectedText = await extractQuote(card);
        try {
          await card.click();
          await page.waitForURL(/\/reader\/\d+/, { timeout: 15000 });
          await page.waitForSelector(".reader-content-area", { timeout: 15000 });
          await page.waitForSelector(".readora-note-highlight-overlay", { state: "attached", timeout: 8000 });
          const url = page.url();
          const checks = await checkHighlight(page, expectedText);
          const pass = verdict(checks, url, null);
          results.push({ phase: "библиотека → заметка", item: label, url, checks, pass });
          console.log(`${pass ? "OK " : "FAIL"} [заметка] ${label}`);
        } catch (error) {
          results.push({
            phase: "библиотека → заметка",
            item: label,
            error: String(error).slice(0, 200),
            pass: false,
          });
          console.log(`FAIL [заметка] ${label}: ${String(error).slice(0, 120)}`);
        }
        await openLibraryTab(page);
      }
    }

    // ---------------------------------------------------------------
    // Фаза 2: закладки из библиотеки
    // ---------------------------------------------------------------
    {
      await openLibraryTab(page);
      await page.click('div button:has-text("Закладки")');
      await page.waitForTimeout(300);
      const cards = page.locator('a[href^="/reader/"]');
      const total = await cards.count();
      const texts = await cards.allInnerTexts();
      const v1Idx = texts.map((t, i) => (t.includes("(v1)") ? i : -1)).filter((i) => i >= 0);
      const v2Idx = texts.map((t, i) => (!t.includes("(v1)") ? i : -1)).filter((i) => i >= 0);
      const sample = [
        ...v1Idx.slice(0, SAMPLE_PER_PHASE / 2),
        ...v2Idx.slice(0, SAMPLE_PER_PHASE / 2),
      ].slice(0, SAMPLE_PER_PHASE);

      for (const idx of sample) {
        const card = cards.nth(idx);
        const label = (texts[idx] ?? "").split("\n")[0]?.slice(0, 60) ?? `карточка #${idx}`;
        const expectedText = await extractQuote(card);
        try {
          await card.click();
          await page.waitForURL(/\/reader\/\d+/, { timeout: 15000 });
          await page.waitForSelector(".reader-content-area", { timeout: 15000 });
          await page.waitForSelector(".readora-note-highlight-overlay", { state: "attached", timeout: 8000 });
          const url = page.url();
          const checks = await checkHighlight(page, expectedText);
          const pass = verdict(checks, url, null);
          results.push({ phase: "библиотека → закладка", item: label, url, checks, pass });
          console.log(`${pass ? "OK " : "FAIL"} [закладка] ${label}`);
        } catch (error) {
          results.push({
            phase: "библиотека → закладка",
            item: label,
            error: String(error).slice(0, 200),
            pass: false,
          });
          console.log(`FAIL [закладка] ${label}: ${String(error).slice(0, 120)}`);
        }
        await openLibraryTab(page);
        await page.click('div button:has-text("Закладки")');
        await page.waitForTimeout(300);
      }
    }

    // ---------------------------------------------------------------
    // Фаза 3: межцикловое отображение и переход из ридера
    // ---------------------------------------------------------------
    {
      // 3a. панель закладок книги A показывает закладки других книг цикла
      await page.goto(`${BASE_URL}/reader/${CYCLE_BOOK_A}`);
      await page.waitForSelector(".reader-content-area", { timeout: 20000 });
      await page.waitForTimeout(1000);
      await page.click('button[aria-label="Закладки"]');
      await page.waitForTimeout(500);

      const foreignBookmark = page.locator('button:has-text("Под струной")');
      const foreignBookmarkCount = await foreignBookmark.count();
      const foreignKogotok = await page.locator('button:has-text("Коготок Большого Взрыва")').count();
      const crossVisible = foreignBookmarkCount + (await page.locator('button:has-text("Коготок")').count());
      console.log(
        `Панель закладок книги ${CYCLE_BOOK_A}: чужих закладок цикла = ${crossVisible} (Под струной: ${foreignBookmarkCount}, Коготок: ${foreignKogotok})`,
      );
      results.push({
        phase: "ридер: межцикловое отображение (закладки)",
        item: "чужие закладки в панели",
        pass: crossVisible > 0,
      });

      if (foreignBookmarkCount > 0) {
        const target = foreignBookmark.first();
        const label = (await target.innerText()).slice(0, 60);
        const expectedText = await extractQuote(target);
        try {
          await target.click();
          await page.waitForURL(new RegExp(`/reader/(127|128)`), { timeout: 15000 });
          await page.waitForSelector(".reader-content-area", { timeout: 15000 });
          await page.waitForSelector(".readora-note-highlight-overlay", { state: "attached", timeout: 8000 });
          const url = page.url();
          const checks = await checkHighlight(page, expectedText);
          const pass = verdict(checks, url, null);
          results.push({ phase: "ридер: межцикловый переход (закладка)", item: label, url, checks, pass });
          console.log(`${pass ? "OK " : "FAIL"} [межцикловая закладка] ${label}`);
        } catch (error) {
          results.push({
            phase: "ридер: межцикловый переход (закладка)",
            item: label,
            error: String(error).slice(0, 200),
            pass: false,
          });
          console.log(`FAIL [межцикловая закладка] ${label}: ${String(error).slice(0, 120)}`);
        }
      }

      // 3b. панель заметок книги A показывает заметки других книг цикла
      await page.goto(`${BASE_URL}/reader/${CYCLE_BOOK_A}`);
      await page.waitForSelector(".reader-content-area", { timeout: 20000 });
      await page.waitForTimeout(1000);
      await page.click('button[aria-label="Заметки"]');
      await page.waitForTimeout(500);

      const foreignNote = page.locator('button:has-text("Коготок Большого Взрыва")');
      const foreignNoteCount = await foreignNote.count();
      console.log(`Панель заметок книги ${CYCLE_BOOK_A}: чужих заметок цикла = ${foreignNoteCount}`);
      results.push({
        phase: "ридер: межцикловое отображение (заметки)",
        item: "чужие заметки в панели",
        pass: foreignNoteCount > 0,
      });

      if (foreignNoteCount > 0) {
        const target = foreignNote.first();
        const label = (await target.innerText()).slice(0, 60);
        const expectedText = await extractQuote(target);
        try {
          await target.click();
          await page.waitForURL(/\/reader\/128/, { timeout: 15000 });
          await page.waitForSelector(".reader-content-area", { timeout: 15000 });
          await page.waitForSelector(".readora-note-highlight-overlay", { state: "attached", timeout: 8000 });
          const url = page.url();
          const checks = await checkHighlight(page, expectedText);
          const pass = verdict(checks, url, "128");
          results.push({ phase: "ридер: межцикловый переход (заметка)", item: label, url, checks, pass });
          console.log(`${pass ? "OK " : "FAIL"} [межцикловая заметка] ${label}`);
        } catch (error) {
          results.push({
            phase: "ридер: межцикловый переход (заметка)",
            item: label,
            error: String(error).slice(0, 200),
            pass: false,
          });
          console.log(`FAIL [межцикловая заметка] ${label}: ${String(error).slice(0, 120)}`);
        }
      }
    }

    // ---------------------------------------------------------------
    // Фаза 4: переход по заметке той же книги внутри ридера
    // ---------------------------------------------------------------
    {
      await page.goto(`${BASE_URL}/reader/${CYCLE_BOOK_A}`);
      await page.waitForSelector(".reader-content-area", { timeout: 20000 });
      await page.waitForTimeout(1000);
      await page.click('button[aria-label="Заметки"]');
      await page.waitForTimeout(500);

      // заметка текущей книги: карточка с «Глава N» без названия чужой книги
      const sameBookNote = page.locator('button:has-text("Глава")').first();
      const label = (await sameBookNote.innerText()).slice(0, 60);
      const expectedText = await extractQuote(sameBookNote);
      try {
        const urlBefore = page.url();
        await sameBookNote.click();
        await page.waitForSelector(".readora-note-highlight-overlay", { state: "attached", timeout: 8000 });
        const url = page.url();
        const checks = await checkHighlight(page, expectedText);
        const pass = verdict(checks, url, String(CYCLE_BOOK_A)) && url === urlBefore;
        results.push({ phase: "ридер: заметка той же книги", item: label, url, checks, pass });
        console.log(`${pass ? "OK " : "FAIL"} [заметка в ридере] ${label}`);
      } catch (error) {
        results.push({
          phase: "ридер: заметка той же книги",
          item: label,
          error: String(error).slice(0, 200),
          pass: false,
        });
        console.log(`FAIL [заметка в ридере] ${label}: ${String(error).slice(0, 120)}`);
      }
    }
  } finally {
    await browser.close();
  }

  // Отчёт
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} проверок пройдено ===`);
  if (failed.length > 0) {
    console.log("Провалы:");
    for (const f of failed) {
      console.log(`- [${f.phase}] ${f.item}${f.error ? ` — ${f.error}` : ""}`);
    }
  }

  mkdirSync(path.join(process.cwd(), ".tmp"), { recursive: true });
  writeFileSync(
    path.join(process.cwd(), ".tmp", "e2e-report.json"),
    JSON.stringify({ startedAt: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2),
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
