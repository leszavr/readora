/**
 * E2E-подготовка: тестовый пользователь + книги + 50 заметок + 50 закладок
 * с реалистичными якорями (микс v1 legacy и v2 semantic с цитатным контекстом).
 *
 * Запуск: DATABASE_URL=... pnpm --filter @workspace/scripts exec tsx src/e2e-seed.ts
 * Идемпотентно: пересоздаёт тестового пользователя (каскад чистит его данные).
 */
import bcrypt from "bcryptjs";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  booksTable,
  bookmarksTable,
  chaptersTable,
  cyclesTable,
  notesTable,
  readingProgressTable,
  usersTable,
} from "@workspace/db";

const TEST_EMAIL = "reader.e2e@test.local";
const TEST_USERNAME = "E2E Reader";
const TEST_PASSWORD = "E2eReader#2026";

const CYCLE_SOURCE_BOOK_IDS = [31, 32, 33]; // Головачёв: На струне / Под струной / Коготок Большого Взрыва
const SOLO_SOURCE_BOOK_IDS = [1, 7]; // Жизнь коротка / Пробуждение Левиафана

const COLORS = ["yellow", "green", "blue", "pink", "purple"];
const IMG_PLACEHOLDER =
  '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==" alt="">';

// Детерминированный PRNG для воспроизводимости сценария
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry42(42);
function mulberry42(seed: number) {
  return mulberry32(seed);
}
const randInt = (min: number, max: number) => Math.floor(rnd() * (max - min + 1)) + min;
const pick = <T>(arr: T[]): T => arr[randInt(0, arr.length - 1)];

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Декодирует основные HTML-entities — DOM textContent их декодирует, генератор должен тоже */
function decodeEntities(html: string): string {
  const named: Record<string, string> = {
    "&nbsp;": " ",
    "&mdash;": "—",
    "&ndash;": "–",
    "&hellip;": "…",
    "&laquo;": "«",
    "&raquo;": "»",
    "&ldquo;": "“",
    "&rdquo;": "”",
    "&lsquo;": "‘",
    "&rsquo;": "’",
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&apos;": "'",
  };
  return html
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&[a-zA-Z]+;/g, (ent: string) => named[ent] ?? ent);
}

function contentHashOf(elementText: string): string {
  const normalized = elementText.slice(0, 100).toLowerCase().replace(/\s+/g, " ").trim();
  return `${normalized.slice(0, 20)}:${elementText.length}`;
}

interface Block {
  tag: string;
  text: string;
  /** Оффсет текста блока в «сыром» тексте контентной области */
  startInRaw: number;
}

/**
 * Разбирает htmlContent на плоские блоки <p>/<h*> и строит приближение
 * сырого текста contentArea (заголовок главы + htmlContent без тегов).
 */
function parseChapter(chapterTitle: string, htmlContent: string): { rawText: string; blocks: Block[] } {
  const decoded = decodeEntities(htmlContent);
  const rawText = chapterTitle + decoded.replace(/<[^>]+>/g, "");
  const blocks: Block[] = [];
  const re = /<(p|h[1-6]|li|blockquote)[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(decoded)) !== null) {
    const tag = m[1];
    const inner = m[2];
    const before = decoded.slice(0, m.index).replace(/<[^>]+>/g, "");
    blocks.push({
      tag,
      text: inner.replace(/<[^>]+>/g, ""),
      startInRaw: chapterTitle.length + before.length,
    });
  }
  return { rawText, blocks };
}

interface GeneratedAnchor {
  positionRaw: string;
  selectedText: string;
}

function makeV2Anchor(chapterId: number, rawText: string, blocks: Block[]): GeneratedAnchor | null {
  const block = pick(blocks);
  if (!block || collapseWhitespace(block.text).length < 60) return null;
  let charOffset = Math.floor(block.text.length * (0.05 + rnd() * 0.85));
  while (charOffset < block.text.length && /\s/.test(block.text[charOffset]!)) charOffset++;
  if (charOffset >= block.text.length) return null;

  const globalOffset = block.startInRaw + charOffset;
  const rawExact = rawText.slice(globalOffset, globalOffset + 64);
  const rawPrefix = rawText.slice(Math.max(0, globalOffset - 32), globalOffset);
  const rawSuffix = rawText.slice(globalOffset + rawExact.length, globalOffset + rawExact.length + 32);
  const quoteExact = collapseWhitespace(rawExact);
  if (quoteExact.length < 8) return null;

  const pIndex = blocks.filter((b) => b.tag === "p").indexOf(block) + 1;
  // Реальный фронтенд добавляет в v2-позицию и textSelection (якорь выделения)
  const selectedTextRaw = rawExact.trim().slice(0, 100);
  const position = {
    chapterId,
    elementPath: `p:nth-of-type(${pIndex})`,
    elementTag: "p",
    charOffset,
    chapterPercent: Math.round((globalOffset / Math.max(1, rawText.length)) * 100),
    contentHash: contentHashOf(block.text),
    textPreview: block.text.slice(0, 50).replace(/\s+/g, " ").trim(),
    textOffset: globalOffset,
    quoteExact,
    quotePrefix: collapseWhitespace(rawPrefix) || undefined,
    quoteSuffix: collapseWhitespace(rawSuffix) || undefined,
    textSelection: {
      version: 1,
      startOffset: globalOffset,
      endOffset: globalOffset + rawExact.trim().length,
      selectedText: selectedTextRaw,
      quotePrefix: collapseWhitespace(rawPrefix) || undefined,
      quoteSuffix: collapseWhitespace(rawSuffix) || undefined,
    },
    version: 2,
    timestamp: Date.now(),
  };
  return {
    positionRaw: JSON.stringify(position),
    selectedText: selectedTextRaw,
  };
}

function makeV1Anchor(
  chapterId: number,
  rawText: string,
  blocks: Block[],
  staleScrollTop: number,
): GeneratedAnchor | null {
  const block = pick(blocks);
  if (!block || collapseWhitespace(block.text).length < 60) return null;
  const charOffset = Math.floor(block.text.length * (0.05 + rnd() * 0.85));
  const globalOffset = block.startInRaw + charOffset;
  const len = randInt(30, 80);
  const selectedText = rawText.slice(globalOffset, globalOffset + len).trim();
  if (selectedText.length < 10) return null;

  const rawPrefix = rawText.slice(Math.max(0, globalOffset - 32), globalOffset);
  const rawSuffix = rawText.slice(globalOffset + len, globalOffset + len + 32);

  const position = {
    chapterId,
    version: 1,
    scrollTop: staleScrollTop,
    textSelection: {
      version: 1,
      startOffset: globalOffset,
      endOffset: globalOffset + len,
      selectedText,
      quotePrefix: collapseWhitespace(rawPrefix) || undefined,
      quoteSuffix: collapseWhitespace(rawSuffix) || undefined,
    },
  };
  return { positionRaw: JSON.stringify(position), selectedText };
}

async function main(): Promise<void> {
  // 1. Идемпотентная пересборка тестового пользователя
  await db.delete(usersTable).where(eq(usersTable.email, TEST_EMAIL));
  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
  const [user] = await db
    .insert(usersTable)
    .values({
      email: TEST_EMAIL,
      username: TEST_USERNAME,
      passwordHash,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      analyticsOptIn: true,
    })
    .returning();
  if (!user) throw new Error("Не удалось создать тестового пользователя");
  console.log(`Тестовый пользователь: id=${user.id} email=${TEST_EMAIL} пароль=${TEST_PASSWORD}`);

  // 2. Книги из существующей базы (копии для тестового пользователя)
  const sourceBooks = await db
    .select()
    .from(booksTable)
    .where(inArray(booksTable.id, [...CYCLE_SOURCE_BOOK_IDS, ...SOLO_SOURCE_BOOK_IDS]));
  if (sourceBooks.length === 0) throw new Error("Исходные книги не найдены");

  const [cycle] = await db
    .insert(cyclesTable)
    .values({ ownerUserId: user.id, name: "Тестовый цикл: Головачёв" })
    .returning();

  const oldToNewBook = new Map<number, number>();
  for (const src of sourceBooks) {
    const inCycle = CYCLE_SOURCE_BOOK_IDS.includes(src.id);
    const [copy] = await db
      .insert(booksTable)
      .values({
        ownerUserId: user.id,
        title: src.title,
        author: src.author,
        description: src.description,
        coverPath: src.coverPath,
        format: src.format,
        language: src.language,
        publicationYear: src.publicationYear,
        cycleId: inCycle ? cycle.id : null,
        cycleName: inCycle ? src.cycleName : null,
        cycleNumber: inCycle ? src.cycleNumber : null,
        storageKey: src.storageKey,
        fileHash: src.fileHash,
        fileSize: src.fileSize,
        status: "active",
        hideFromPopular: true,
        uploadedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    oldToNewBook.set(src.id, copy.id);

    // Копия глав; тяжёлые data-URI картинки → placeholder (текст не меняется)
    const srcChapters = await db
      .select()
      .from(chaptersTable)
      .where(eq(chaptersTable.bookId, src.id))
      .orderBy(chaptersTable.index);
    if (srcChapters.length > 0) {
      await db.insert(chaptersTable).values(
        srcChapters.map((ch) => ({
          bookId: copy.id,
          index: ch.index,
          title: ch.title,
          htmlContent: ch.htmlContent.replace(/<img[^>]*>/g, IMG_PLACEHOLDER),
          wordCount: ch.wordCount,
        })),
      );
    }
    console.log(`Книга: ${src.title} (старый id=${src.id} → новый id=${copy.id}, цикл=${inCycle ? "да" : "нет"})`);
  }

  // 3. 50 заметок + 50 закладок (по 10 на книгу, микс v1/v2)
  const newBookIds = [...oldToNewBook.values()];
  const chaptersByBook = new Map<number, Array<{ id: number; title: string; htmlContent: string }>>();
  for (const bookId of newBookIds) {
    const rows = await db
      .select({ id: chaptersTable.id, title: chaptersTable.title, htmlContent: chaptersTable.htmlContent })
      .from(chaptersTable)
      .where(eq(chaptersTable.bookId, bookId))
      .orderBy(chaptersTable.index);
    // Только главы с достаточным текстом
    chaptersByBook.set(
      bookId,
      rows.filter((r) => r.htmlContent.includes("<p>")),
    );
  }

  let noteNo = 0;
  let bookmarkNo = 0;
  const noteStats = { v1: 0, v2: 0 };
  const bookmarkStats = { v1: 0, v2: 0 };
  const anchorCache = new Map<string, { rawText: string; blocks: Block[] }>();

  for (const bookId of newBookIds) {
    const chapters = chaptersByBook.get(bookId) ?? [];
    if (chapters.length === 0) continue;

    const makeAnchor = (useV1: boolean, rawText: string, blocks: Block[]) =>
      useV1
        ? makeV1Anchor(chapter.id, rawText, blocks, randInt(0, 4000))
        : makeV2Anchor(chapter.id, rawText, blocks);

    let chapter = pick(chapters);
    let cacheKey = `${bookId}:${chapter.id}`;
    if (!anchorCache.has(cacheKey)) {
      anchorCache.set(cacheKey, parseChapter(chapter.title, chapter.htmlContent));
    }
    let parsed = anchorCache.get(cacheKey)!;

    const nextChapter = () => {
      chapter = pick(chapters);
      cacheKey = `${bookId}:${chapter.id}`;
      if (!anchorCache.has(cacheKey)) {
        anchorCache.set(cacheKey, parseChapter(chapter.title, chapter.htmlContent));
      }
      parsed = anchorCache.get(cacheKey)!;
      return parsed;
    };

    // 10 заметок: 3 v1 (stale scrollTop) + 7 v2, с повторами при неудачных блоках
    for (let created = 0, v1Count = 0, guard = 0; created < 10 && guard < 60; guard++) {
      const useV1Note = v1Count < 3;
      let anchor = makeAnchor(useV1Note, parsed.rawText, parsed.blocks);
      while (!anchor && guard < 60) {
        guard++;
        const next = nextChapter();
        anchor = makeAnchor(useV1Note, next.rawText, next.blocks);
      }
      if (!anchor) continue;
      noteNo++;
      noteStats[useV1Note ? "v1" : "v2"]++;
      if (useV1Note) v1Count++;
      const daysAgo = rnd() * 3;
      await db.insert(notesTable).values({
        userId: user.id,
        bookId,
        chapterId: chapter.id,
        positionRaw: anchor.positionRaw,
        highlightedText: anchor.selectedText,
        noteText: `E2E заметка #${noteNo} (${useV1Note ? "v1" : "v2"}): ${anchor.selectedText.slice(0, 40)}`,
        color: pick(COLORS),
        createdAt: new Date(Date.now() - daysAgo * 86400000),
        updatedAt: new Date(Date.now() - daysAgo * 43200000),
      });
      created++;
    }

    // 10 закладок: 3 v1 + 7 v2, с повторами
    for (let created = 0, v1Count = 0, guard = 0; created < 10 && guard < 60; guard++) {
      const useV1Bookmark = v1Count < 3;
      let anchor = makeAnchor(useV1Bookmark, parsed.rawText, parsed.blocks);
      while (!anchor && guard < 60) {
        guard++;
        const next = nextChapter();
        anchor = makeAnchor(useV1Bookmark, next.rawText, next.blocks);
      }
      if (!anchor) continue;
      bookmarkNo++;
      bookmarkStats[useV1Bookmark ? "v1" : "v2"]++;
      if (useV1Bookmark) v1Count++;
      await db.insert(bookmarksTable).values({
        userId: user.id,
        bookId,
        chapterId: chapter.id,
        positionRaw: anchor.positionRaw,
        label: `E2E закладка #${bookmarkNo} (${useV1Bookmark ? "v1" : "v2"})`,
        selectedText: anchor.selectedText,
        createdAt: new Date(Date.now() - rnd() * 3 * 86400000),
      });
      created++;
    }
  }
  console.log(`Заметок: ${noteNo} (v1: ${noteStats.v1}, v2: ${noteStats.v2})`);
  console.log(`Закладок: ${bookmarkNo} (v1: ${bookmarkStats.v1}, v2: ${bookmarkStats.v2})`);

  // 4. Прогресс чтения по первой цикловой книге — глава с заметками,
  // чтобы проверить подавление progress-restore при jump
  const cycleBookA = oldToNewBook.get(CYCLE_SOURCE_BOOK_IDS[0]!)!;
  const chaptersA = chaptersByBook.get(cycleBookA) ?? [];
  if (chaptersA.length > 0) {
    const targetChapter = chaptersA[Math.floor(chaptersA.length / 2)]!;
    await db.insert(readingProgressTable).values({
      userId: user.id,
      bookId: cycleBookA,
      currentChapterId: targetChapter.id,
      currentPosition: JSON.stringify({
        chapterId: targetChapter.id,
        scrollTop: 5000,
        scrollHeight: 50000,
        clientHeight: 800,
        timestamp: Date.now(),
      }),
      progressPercent: 35,
      readingStatus: "reading",
      lastReadAt: new Date(),
    });
    console.log(`Прогресс чтения: книга id=${cycleBookA}, глава id=${targetChapter.id} (v1 с метриками)`);
  }

  console.log("\n=== Данные для E2E готовы ===");
  console.log(`Логин: ${TEST_EMAIL}`);
  console.log(`Пароль: ${TEST_PASSWORD}`);
  console.log(`Книги: ${[...oldToNewBook.entries()].map(([o, n]) => `${o}→${n}`).join(", ")}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
