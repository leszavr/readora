/**
 * E2E-проверка jump-hold: переход по заметке/закладке не должен перезаписывать
 * сохранённую позицию чтения, пока пользователь не продолжил чтение.
 *
 * Сценарии:
 *  S0 (контроль): обычное чтение — скролл сохраняет позицию;
 *  S1: прыжок по закладке в ту же главу без скролла — позиция не меняется;
 *  S2: мелкая подстройка вида (< экрана) после прыжка — позиция не меняется;
 *  S3: скролл на экран после прыжка — позиция сохраняется;
 *  S4: прыжок в другую главу + навигация по оглавлению — сохранение
 *      возобновляется (чтение продолжается);
 *  S5: межкнижный прыжок по закладке цикла — прогресс исходной книги не
 *      перезаписывается;
 *  S6: прыжок и закрытие ридера без чтения — unmount-сохранение подавлено.
 *
 * Требует: dev-серверы (api :5000, client :3000), seeded-данные (e2e-seed.ts).
 * Запуск: pnpm --filter @workspace/scripts exec tsx src/e2e-progress-hold.ts
 */
import { chromium, type Page } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const TEST_EMAIL = "reader.e2e@test.local";
const TEST_PASSWORD = "E2eReader#2026";
const BOOK_ID = parseInt(process.env.E2E_BOOK_ID ?? "126", 10);

const chromiumPath = path.join(
  homedir(),
  ".cache/ms-playwright/chromium-1243/chrome-linux64/chrome",
);

interface BookmarkDto {
  id: string;
  bookId: number;
  chapterId: number;
  label: string | null;
  selectedText: string | null;
  bookTitle?: string | null;
}

interface ChapterDto {
  id: number;
  index: number;
  title: string;
  wordCount: number | null;
}

interface ProgressDto {
  currentChapterId: number | null;
  currentPosition: string | null;
  progressPercent: number | null;
  readingStatus: string;
}

interface CaseResult {
  scenario: string;
  pass: boolean;
  details?: Record<string, unknown>;
  error?: string;
}

function baselinePosition(chapterId: number): string {
  return JSON.stringify({
    chapterId,
    version: 1,
    scrollTop: 5000,
    scrollHeight: 50000,
    clientHeight: 800,
    timestamp: Date.now(),
  });
}

async function api<T>(page: Page, method: "GET" | "PUT", path: string, body?: unknown): Promise<T> {
  const res = await page.request.fetch(`${BASE_URL}/api${path}`, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    data: body,
  });
  if (!res.ok()) throw new Error(`API ${method} ${path} → ${res.status()}`);
  return res.json() as Promise<T>;
}

const getProgress = (page: Page) => api<ProgressDto>(page, "GET", `/books/${BOOK_ID}/progress`);

async function putBaseline(page: Page, chapterId: number): Promise<string> {
  const position = baselinePosition(chapterId);
  await api<ProgressDto>(page, "PUT", `/books/${BOOK_ID}/progress`, {
    currentChapterId: chapterId,
    currentPosition: position,
    progressPercent: 10,
    readingStatus: "reading",
  });
  return position;
}

async function clearLocalProgress(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("readora:reader-progress")) localStorage.removeItem(key);
    }
  });
}

async function login(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/login`);
  await page.fill('input[placeholder="you@example.com"]', TEST_EMAIL);
  await page.fill('input[placeholder="••••••••"]', TEST_PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/library/, { timeout: 20000 });
}

async function openReader(page: Page): Promise<void> {
  await clearLocalProgress(page);
  await page.goto(`${BASE_URL}/reader/${BOOK_ID}`);
  await page.waitForSelector(".reader-content-area", { timeout: 20000 });
  // restore позиции + фоновый пересохран восстановленной позиции при открытии
  // (debounce 1.5s) — даём ему завершиться до прыжка, чтобы опорный прогресс
  // был стабильным
  await page.waitForTimeout(3500);
}

async function openBookmarksPanel(page: Page): Promise<void> {
  await page.click('button[aria-label="Закладки"]');
  await page.waitForTimeout(500);
}

async function clickBookmark(page: Page, bm: BookmarkDto): Promise<void> {
  const panel = page.locator("div.fixed.right-2.top-14");
  const matcher = bm.bookId !== BOOK_ID ? bm.bookTitle : (bm.label ?? bm.selectedText);
  if (!matcher) throw new Error("Закладка без label/selectedText — нечем сопоставить entry");
  const entry = panel.locator("button.flex-1", { hasText: matcher }).first();
  await entry.click();
}

interface ScrollInfo {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

async function scrollInfo(page: Page): Promise<ScrollInfo> {
  return page.evaluate(() => {
    const area = document.querySelector(".reader-content-area");
    const container = area?.closest(".overflow-y-auto") as HTMLElement | null;
    if (!container) throw new Error("Скролл-контейнер ридера не найден");
    return {
      scrollTop: container.scrollTop,
      scrollHeight: container.scrollHeight,
      clientHeight: container.clientHeight,
    };
  });
}

/** Пользовательский скролл (не программный): выбирает направление с запасом места */
async function userScroll(page: Page, px: number): Promise<number> {
  return page.evaluate((delta) => {
    const area = document.querySelector(".reader-content-area");
    const container = area?.closest(".overflow-y-auto") as HTMLElement | null;
    if (!container) throw new Error("Скролл-контейнер ридера не найден");
    const roomDown = container.scrollHeight - container.clientHeight - container.scrollTop;
    const dir = roomDown >= Math.abs(delta) + 50 ? 1 : -1;
    const before = container.scrollTop;
    container.scrollTop += dir * delta;
    return Math.abs(container.scrollTop - before);
  }, px);
}

async function run(): Promise<void> {
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  const results: CaseResult[] = [];

  const record = (scenario: string, pass: boolean, details?: Record<string, unknown>, error?: string) => {
    results.push({ scenario, pass, details, error });
    console.log(`${pass ? "OK " : "FAIL"} [${scenario}]${error ? ` — ${error}` : ""}`);
  };

  try {
    await login(page);

    // ---------------------------------------------------------------
    // Подготовка данных: закладки/главы/прогресс
    // ---------------------------------------------------------------
    const bookmarks = await api<BookmarkDto[]>(page, "GET", `/books/${BOOK_ID}/bookmarks`);
    const chapters = await api<ChapterDto[]>(page, "GET", `/books/${BOOK_ID}/chapters`);
    const ownBookmarks = bookmarks.filter((b) => b.bookId === BOOK_ID);
    if (ownBookmarks.length === 0) throw new Error("Нет закладок — прогоните scripts/src/e2e-seed.ts");

    // bm1 — та же глава, что и baseline (самая длинная глава среди закладок);
    // bm2 — другая глава; foreign — закладка другой книги цикла
    const wordCountByChapter = new Map(chapters.map((c) => [c.id, c.wordCount ?? 0]));
    const ownSorted = [...ownBookmarks].sort(
      (a, b) => (wordCountByChapter.get(b.chapterId) ?? 0) - (wordCountByChapter.get(a.chapterId) ?? 0),
    );
    const bm1 = ownSorted[0]!;
    const bm2 = ownBookmarks.find((b) => b.chapterId !== bm1.chapterId) ?? null;
    const foreign = bookmarks.find((b) => b.bookId !== BOOK_ID) ?? null;
    const C1 = bm1.chapterId;
    const bm2ChapterIdx = bm2 ? chapters.findIndex((c) => c.id === bm2.chapterId) : -1;

    console.log(`Книга ${BOOK_ID}: baseline-глава id=${C1}, закладок своих=${ownBookmarks.length}, чужих=${foreign ? 1 : 0}`);

    // ---------------------------------------------------------------
    // S0 (контроль): обычное чтение сохраняет позицию
    // ---------------------------------------------------------------
    {
      await putBaseline(page, C1);
      await openReader(page);
      const before = await getProgress(page);
      const info = await scrollInfo(page);
      if (info.scrollHeight - info.clientHeight < 2.5 * info.clientHeight) {
        record("S0 контроль: обычное чтение", false, undefined, "глава слишком короткая для скролл-сценариев — выберите закладку в длинной главе");
      } else {
        await userScroll(page, Math.round(1.5 * info.clientHeight));
        await page.waitForTimeout(3500);
        const after = await getProgress(page);
        const pass = after.currentChapterId === C1 && after.currentPosition !== before.currentPosition;
        record("S0 контроль: обычное чтение", pass, {
          chapterId: after.currentChapterId,
          positionChanged: after.currentPosition !== before.currentPosition,
        }, pass ? undefined : "позиция не сохранилась при обычном чтении (без прыжка)");
      }
    }

    // ---------------------------------------------------------------
    // S1: прыжок по закладке в ту же главу, без скролла — позиция не меняется
    // ---------------------------------------------------------------
    {
      await putBaseline(page, C1);
      await openReader(page);
      await openBookmarksPanel(page);
      const before = await getProgress(page);
      await clickBookmark(page, bm1);
      // restore прыжка (~1.2s) + окно debounce-сохранения (1.5s) + запас
      await page.waitForTimeout(4500);
      const after = await getProgress(page);
      const pass =
        after.currentChapterId === before.currentChapterId &&
        after.currentPosition === before.currentPosition &&
        after.progressPercent === before.progressPercent;
      record("S1 прыжок в ту же главу без скролла", pass, {
        chapterId: after.currentChapterId,
        positionIntact: after.currentPosition === before.currentPosition,
        percent: after.progressPercent,
      }, pass ? undefined : "позиция чтения перезаписана позицией прыжка");
    }

    // ---------------------------------------------------------------
    // S2: мелкая подстройка вида после прыжка (< экрана) — позиция не меняется
    // ---------------------------------------------------------------
    {
      await putBaseline(page, C1);
      await openReader(page);
      await openBookmarksPanel(page);
      const before = await getProgress(page);
      await clickBookmark(page, bm1);
      await page.waitForTimeout(2500); // приземление + settle hold
      const info = await scrollInfo(page);
      await userScroll(page, Math.round(0.3 * info.clientHeight));
      await page.waitForTimeout(3500);
      const after = await getProgress(page);
      const pass =
        after.currentChapterId === before.currentChapterId &&
        after.currentPosition === before.currentPosition;
      record("S2 мелкий скролл после прыжка", pass, {
        chapterId: after.currentChapterId,
        positionIntact: after.currentPosition === before.currentPosition,
      }, pass ? undefined : "мелкая подстройка вида сняла hold и перезаписала позицию");
    }

    // ---------------------------------------------------------------
    // S3: скролл на экран после прыжка — чтение продолжается, позиция сохраняется
    // ---------------------------------------------------------------
    {
      await putBaseline(page, C1);
      await openReader(page);
      await openBookmarksPanel(page);
      const before = await getProgress(page);
      await clickBookmark(page, bm1);
      await page.waitForTimeout(2500);
      const info = await scrollInfo(page);
      const scrolled = await userScroll(page, Math.round(1.2 * info.clientHeight));
      await page.waitForTimeout(3500);
      const after = await getProgress(page);
      const pass =
        scrolled >= info.clientHeight &&
        after.currentChapterId === before.currentChapterId &&
        after.currentPosition !== before.currentPosition;
      record("S3 скролл на экран после прыжка", pass, {
        scrolled,
        chapterId: after.currentChapterId,
        positionChanged: after.currentPosition !== before.currentPosition,
      }, pass ? undefined : "после скролла на экран позиция не сохранилась (hold не снялся или сохранение сломано)");
    }

    // ---------------------------------------------------------------
    // S4: прыжок в другую главу + навигация по оглавлению — сохранение возобновляется
    // ---------------------------------------------------------------
    if (!bm2) {
      record("S4 прыжок в другую главу + оглавление", false, undefined, "нет закладки в другой главе — прогоните e2e-seed");
    } else {
      await putBaseline(page, C1);
      await openReader(page);
      await openBookmarksPanel(page);
      const before = await getProgress(page);
      await clickBookmark(page, bm2);
      await page.waitForTimeout(2500);
      // навигация по оглавлению = продолжение чтения: hold снимается,
      // сохранение позиции главы прыжка уходит при уходе с главы
      await page.click("button:has(.lucide-list)");
      await page.waitForTimeout(500);
      const tocTargetIdx = bm2ChapterIdx === 0 ? 1 : 0;
      await page.locator("div.fixed.right-2.top-14 button.w-full").nth(tocTargetIdx).click();
      await page.waitForTimeout(2500);
      const after = await getProgress(page);
      const pass =
        after.currentChapterId === bm2.chapterId &&
        after.currentPosition !== before.currentPosition;
      record("S4 прыжок в другую главу + оглавление", pass, {
        chapterId: after.currentChapterId,
        expectedJumpChapterId: bm2.chapterId,
        positionChanged: after.currentPosition !== before.currentPosition,
      }, pass ? undefined : "навигация по оглавлению не возобновила сохранение");
    }

    // ---------------------------------------------------------------
    // S5: межкнижный прыжок — прогресс исходной книги не перезаписывается
    // ---------------------------------------------------------------
    if (!foreign) {
      record("S5 межкнижный прыжок", false, undefined, "нет закладок других книг цикла — прогоните e2e-seed");
    } else {
      await putBaseline(page, C1);
      await openReader(page);
      await openBookmarksPanel(page);
      const before = await getProgress(page);
      await clickBookmark(page, foreign);
      await page.waitForURL(new RegExp(`/reader/(?!${BOOK_ID}$)\\d+`), { timeout: 15000 });
      await page.waitForSelector(".reader-content-area", { timeout: 15000 });
      await page.waitForTimeout(3500);
      const after = await getProgress(page);
      const pass = after.currentChapterId === before.currentChapterId;
      record("S5 межкнижный прыжок", pass, {
        sourceChapterId: after.currentChapterId,
        expectedChapterId: before.currentChapterId,
      }, pass ? undefined : "прогресс исходной книги перезаписан главой прыжка");
    }

    // ---------------------------------------------------------------
    // S6: прыжок и закрытие ридера без чтения — позиция не перезаписывается
    // ---------------------------------------------------------------
    if (!bm2) {
      record("S6 прыжок + закрытие ридера", false, undefined, "нет закладки в другой главе — прогоните e2e-seed");
    } else {
      await putBaseline(page, C1);
      await openReader(page);
      await openBookmarksPanel(page);
      const before = await getProgress(page);
      await clickBookmark(page, bm2);
      // ждём дольше окна debounce-сохранения: без фикса позиция прыжка
      // успела бы перезаписать прогресс ещё до закрытия ридера
      await page.waitForTimeout(4000);
      let after = await getProgress(page);
      let pass = after.currentChapterId === before.currentChapterId;
      if (pass) {
        // SPA-навигация «назад к книге»: ридер демонтируется
        await page.click('a[href^="/book/"]');
        await page.waitForURL(new RegExp(`/book/${BOOK_ID}`), { timeout: 15000 });
        await page.waitForTimeout(2500);
        after = await getProgress(page);
        pass = after.currentChapterId === before.currentChapterId;
      }
      record("S6 прыжок + закрытие ридера", pass, {
        chapterId: after.currentChapterId,
        expectedChapterId: before.currentChapterId,
      }, pass ? undefined : "закрытие ридера после прыжка перезаписало позицию чтения");
    }
  } catch (error) {
    record("выполнение", false, undefined, String(error).slice(0, 300));
  } finally {
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} сценариев пройдено ===`);
  for (const f of failed) console.log(`- FAIL [${f.scenario}] ${f.error ?? ""}`);

  mkdirSync(path.join(process.cwd(), ".tmp"), { recursive: true });
  writeFileSync(
    path.join(process.cwd(), ".tmp", "e2e-progress-hold-report.json"),
    JSON.stringify({ startedAt: new Date().toISOString(), total: results.length, failed: failed.length, results }, null, 2),
  );
  process.exit(failed.length > 0 ? 1 : 0);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
