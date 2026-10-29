import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { parseBook, validateBookFile } from "../src/lib/parser";

// ─── Синтетические бинарные фикстуры ─────────────────────────────────────────

function u16(value: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt16BE(value, 0);
  return buf;
}

function u32(value: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

function ffff(): Buffer {
  return u32(0xffffffff);
}

// 1x1 прозрачный GIF
const TINY_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

function buildPdb(records: Buffer[]): Buffer {
  const header = Buffer.alloc(78);
  header.write("TestBook", 0, "latin1");
  header.write("BOOK", 60, "latin1");
  header.write("MOBI", 64, "latin1");
  header.writeUInt16BE(records.length, 76);

  const infos: Buffer[] = [];
  let offset = 78 + records.length * 8;
  records.forEach((record, i) => {
    const info = Buffer.alloc(8);
    info.writeUInt32BE(offset, 0);
    info.writeUInt8(0, 4);
    info.writeUIntBE(i + 1, 5, 3);
    infos.push(info);
    offset += record.length;
  });

  return Buffer.concat([header, ...infos, ...records]);
}

interface ExthRecord {
  type: number;
  data: Buffer;
}

function exthString(type: number, value: string): ExthRecord {
  return { type, data: Buffer.from(value, "utf8") };
}

function exthUint(type: number, value: number): ExthRecord {
  return { type, data: u32(value) };
}

function buildExth(records: ExthRecord[]): Buffer {
  const parts: Buffer[] = [];
  for (const { type, data } of records) {
    parts.push(u32(type), u32(8 + data.length), data);
  }
  const body = Buffer.concat(parts);
  const length = 12 + body.length;
  const padding = (4 - (length % 4)) % 4;
  return Buffer.concat([Buffer.from("EXTH", "latin1"), u32(length + padding), u32(records.length), body, Buffer.alloc(padding)]);
}

interface MobiHeaderOptions {
  compression: number;
  textLength: number;
  numTextRecords: number;
  resourceStart: number;
  title: string;
  exthRecords: ExthRecord[];
  version?: number;
  encryption?: number;
  kf8?: { fdst: number; frag: number; skel: number };
}

function buildRecord0(options: MobiHeaderOptions): Buffer {
  const isKf8 = options.version !== undefined && options.version >= 8;
  const mobiHeaderLength = isKf8 ? 264 : 232;
  const exth = buildExth(options.exthRecords);
  const titleBytes = Buffer.from(options.title, "utf8");
  const titleOffset = 16 + mobiHeaderLength + exth.length;

  const mobi = Buffer.alloc(mobiHeaderLength);
  mobi.write("MOBI", 0, "latin1");
  mobi.writeUInt32BE(mobiHeaderLength, 4);
  mobi.writeUInt32BE(2, 8); // type
  mobi.writeUInt32BE(65001, 12); // encoding: utf-8
  mobi.writeUInt32BE(42, 16); // uid
  mobi.writeUInt32BE(options.version ?? 6, 20); // version
  mobi.writeUInt32BE(titleOffset - 16, 68); // titleOffset (rel)
  mobi.writeUInt32BE(titleBytes.length, 72); // titleLength (rel)
  mobi.writeUInt8(0, 78); // localeRegion (rel 94)
  mobi.writeUInt8(25, 79); // localeLanguage (rel 95): ru
  mobi.writeUInt32BE(options.resourceStart, 92); // resourceStart (rel 108)
  mobi.writeUInt32BE(0xffffffff, 96); // huffcdic (rel 112)
  mobi.writeUInt32BE(0, 100); // numHuffcdic (rel 116)
  mobi.writeUInt32BE(0x40, 112); // exthFlag (rel 128)
  mobi.writeUInt32BE(0, 224); // trailingFlags (rel 240)
  mobi.writeUInt32BE(0xffffffff, 228); // indx (rel 244)
  if (isKf8 && options.kf8) {
    mobi.writeUInt32BE(options.kf8.fdst, 176); // fdst (rel 192)
    mobi.writeUInt32BE(1, 180); // numFdst (rel 196)
    mobi.writeUInt32BE(options.kf8.frag, 232); // frag (rel 248)
    mobi.writeUInt32BE(options.kf8.skel, 236); // skel (rel 252)
    mobi.writeUInt32BE(0xffffffff, 244); // guide (rel 260)
  }

  const palmdoc = Buffer.alloc(16);
  palmdoc.writeUInt16BE(options.compression, 0);
  palmdoc.writeUInt32BE(options.textLength, 4);
  palmdoc.writeUInt16BE(options.numTextRecords, 8);
  palmdoc.writeUInt16BE(4096, 10);
  palmdoc.writeUInt16BE(options.encryption ?? 0, 12);

  return Buffer.concat([palmdoc, mobi, exth, titleBytes]);
}

function splitRecords(data: Buffer, size = 4096): Buffer[] {
  const records: Buffer[] = [];
  for (let offset = 0; offset < data.length || records.length === 0; offset += size) {
    records.push(data.subarray(offset, Math.min(offset + size, data.length)));
    if (offset + size >= data.length) break;
  }
  return records;
}

// Простейший корректный PalmDOC-поток: литералы 0x09-0x7F напрямую,
// остальные байты — кодами «скопировать следующие 1-8 байт».
function compressPalmDocSimple(input: Buffer): Buffer {
  const out: number[] = [];
  let i = 0;
  while (i < input.length) {
    const byte = input[i];
    if (byte >= 0x09 && byte <= 0x7f) {
      out.push(byte);
      i += 1;
      continue;
    }
    let run = 0;
    while (i + run < input.length && run < 8) {
      const next = input[i + run];
      if (next >= 0x09 && next <= 0x7f) break;
      run += 1;
    }
    out.push(run);
    for (let k = 0; k < run; k++) out.push(input[i + k]);
    i += run;
  }
  return Buffer.from(out);
}

function buildMobi6(options: {
  html: string;
  compression: number;
  coverRecord?: Buffer;
}): Buffer {
  const textBuffer = Buffer.from(options.html, "utf8");
  const textRecords =
    options.compression === 2 ? splitRecords(textBuffer).map(compressPalmDocSimple) : splitRecords(textBuffer);
  const resourceStart = 1 + textRecords.length;

  const record0 = buildRecord0({
    compression: options.compression,
    textLength: textBuffer.length,
    numTextRecords: textRecords.length,
    resourceStart,
    title: "Синтетическая книга",
    exthRecords: [
      exthString(100, "Автор Тестов"),
      exthString(503, "Синтетическая книга"),
      exthString(103, "Описание для теста"),
      exthString(106, "2021-03-15"),
      exthString(105, "фантастика"),
      exthString(524, "ru"),
      ...(options.coverRecord ? [exthUint(201, 0)] : []),
    ],
  });

  const records = [record0, ...textRecords];
  if (options.coverRecord) records.push(options.coverRecord);
  return buildPdb(records);
}

// ─── varint (старшие группы вперёд, последний байт с установленным старшим битом)

function varint(value: number): Buffer {
  const groups: number[] = [];
  let v = value;
  do {
    groups.unshift(v & 0x7f);
    v = Math.floor(v / 128);
  } while (v > 0);
  return Buffer.from(groups.map((g, i) => (i === groups.length - 1 ? g | 0x80 : g)));
}

function buildTagx(entries: Array<[number, number, number, number]>): Buffer {
  return Buffer.concat([
    Buffer.from("TAGX", "latin1"),
    u32(12 + entries.length * 4),
    u32(1), // numControlBytes
    ...entries.map(([tag, numValues, mask, end]) => Buffer.from([tag, numValues, mask, end])),
  ]);
}

function buildIndxHeaderRecord(tagxEntries: Array<[number, number, number, number]>, numEntryRecords: number): Buffer {
  const header = Buffer.alloc(56);
  header.write("INDX", 0, "latin1");
  header.writeUInt32BE(56, 4); // length: TAGX начинается сразу после заголовка
  header.writeUInt32BE(0, 8); // type
  header.writeUInt32BE(0, 20); // idxt
  header.writeUInt32BE(numEntryRecords, 24);
  header.writeUInt32BE(65001, 28); // encoding
  header.writeUInt32BE(0, 52); // numCncx
  return Buffer.concat([header, buildTagx(tagxEntries)]);
}

function buildIndxEntryRecord(entries: Array<{ name: string; payload: Buffer }>): Buffer {
  const header = Buffer.alloc(56);
  header.write("INDX", 0, "latin1");
  header.writeUInt32BE(56, 4);

  const entryBuffers = entries.map((entry) =>
    Buffer.concat([Buffer.from([entry.name.length]), Buffer.from(entry.name, "latin1"), entry.payload]),
  );

  let offset = 56;
  const offsets = entryBuffers.map((buffer) => {
    const start = offset;
    offset += buffer.length;
    return start;
  });

  const idxtOffset = offset;
  header.writeUInt32BE(idxtOffset, 20);
  header.writeUInt32BE(entries.length, 24);
  header.writeUInt32BE(65001, 28);

  const idxt = Buffer.concat([Buffer.from("IDXT", "latin1"), ...offsets.map((o) => u16(o))]);
  return Buffer.concat([header, ...entryBuffers, idxt]);
}

function skelEntryPayload(numFrag: number, offset: number, length: number): Buffer {
  // TAGX-маски однобитные: значения читаются как numValues варинтов напрямую (без blob-префикса)
  return Buffer.concat([
    Buffer.from([0xc0]), // control byte: tag 1 (mask 0x40) и tag 6 (mask 0x80) присутствуют
    varint(numFrag),
    varint(offset),
    varint(length),
  ]);
}

function fragEntryPayload(fid: number, offset: number, length: number): Buffer {
  return Buffer.concat([
    Buffer.from([0xe0]), // control byte: tag 2 (0x40), tag 4 (0x20), tag 6 (0x80)
    varint(0), // tag 2: смещение в cncx (пул пуст)
    varint(fid), // tag 4: fid
    varint(offset),
    varint(length),
  ]);
}

function buildFdst(entries: Array<[number, number]>): Buffer {
  const header = Buffer.alloc(12);
  header.write("FDST", 0, "latin1");
  header.writeUInt32BE(entries.length, 8);
  return Buffer.concat([header, ...entries.flatMap(([start, end]) => [u32(start), u32(end)])]);
}

function buildKf8(sections: Array<{ skeleton: string; fragment: string }>): Buffer {
  const flowParts: Buffer[] = [];
  const skelEntries: Array<{ name: string; payload: Buffer }> = [];
  const fragEntries: Array<{ name: string; payload: Buffer }> = [];

  let flowOffset = 0;
  sections.forEach((section, i) => {
    const skeleton = Buffer.from(section.skeleton, "utf8");
    const fragment = Buffer.from(section.fragment, "utf8");
    const insertOffset = skeleton.indexOf("</body>");

    skelEntries.push({ name: `sec${i}`, payload: skelEntryPayload(1, flowOffset, skeleton.length) });
    fragEntries.push({
      name: String(insertOffset),
      payload: fragEntryPayload(i + 1, 0, fragment.length),
    });

    flowParts.push(skeleton, fragment);
    flowOffset += skeleton.length + fragment.length;
  });

  const flow = Buffer.concat(flowParts);
  const textRecords = splitRecords(flow);
  const fdstIndex = 1 + textRecords.length;
  const skelHeaderIndex = fdstIndex + 1;
  const fragHeaderIndex = skelHeaderIndex + 2;
  const resourceStart = fragHeaderIndex + 2;

  const record0 = buildRecord0({
    compression: 1,
    textLength: flow.length,
    numTextRecords: textRecords.length,
    resourceStart,
    title: "Синтетический KF8",
    exthRecords: [
      exthString(100, "KF8 Автор"),
      exthString(503, "Синтетический KF8"),
      exthString(106, "2019-07-20"),
      exthUint(201, 0),
    ],
    version: 8,
    kf8: { fdst: fdstIndex, frag: fragHeaderIndex, skel: skelHeaderIndex },
  });

  const records = [
    record0,
    ...textRecords,
    buildFdst([[0, flow.length]]),
    buildIndxHeaderRecord(
      [
        [1, 1, 0x40, 0],
        [6, 2, 0x80, 0],
      ],
      1,
    ),
    buildIndxEntryRecord(skelEntries),
    buildIndxHeaderRecord(
      [
        [2, 1, 0x40, 0],
        [4, 1, 0x20, 0],
        [6, 2, 0x80, 0],
      ],
      1,
    ),
    buildIndxEntryRecord(fragEntries),
    TINY_GIF,
  ];
  return buildPdb(records);
}

// ─── Тесты MOBI ──────────────────────────────────────────────────────────────

const MOBI6_HTML =
  '<html><body><h1>Глава 1</h1><p>Текст первой главы</p><mbp:pagebreak><h1>Глава 2</h1><p>Текст <img recindex="00001"> второй главы</p></body></html>';

test("MOBI6 без сжатия: метаданные EXTH, обложка, главы по mbp:pagebreak, инлайн картинок", () => {
  const parsed = parseBook(buildMobi6({ html: MOBI6_HTML, compression: 1, coverRecord: TINY_GIF }), "mobi");

  assert.equal(parsed.title, "Синтетическая книга");
  assert.equal(parsed.author, "Автор Тестов");
  assert.equal(parsed.description, "Описание для теста");
  assert.equal(parsed.language, "ru");
  assert.equal(parsed.publicationYear, 2021);
  assert.deepEqual(parsed.genres, ["фантастика"]);
  assert.equal(parsed.coverMime, "image/gif");
  assert.ok(parsed.coverBase64 && parsed.coverBase64.length > 0);

  assert.deepEqual(parsed.chapters.map((c) => c.title), ["Глава 1", "Глава 2"]);
  assert.ok(parsed.chapters[0].htmlContent.includes("Текст первой главы"));
  assert.ok(parsed.chapters[1].htmlContent.includes("Текст"));
  assert.ok(parsed.chapters[1].htmlContent.includes('src="data:image/gif;base64,'));
  assert.ok(parsed.chapters.every((c) => c.wordCount > 0));
});

test("MOBI6 с PalmDOC-сжатиием и кириллицей декодируется идентично", () => {
  const parsed = parseBook(buildMobi6({ html: MOBI6_HTML, compression: 2, coverRecord: TINY_GIF }), "mobi");
  assert.deepEqual(parsed.chapters.map((c) => c.title), ["Глава 1", "Глава 2"]);
  assert.ok(parsed.chapters[0].htmlContent.includes("Текст первой главы"));
  assert.equal(parsed.title, "Синтетическая книга");
});

test("MOBI без обложки и без EXTH-обложки не падает", () => {
  const parsed = parseBook(buildMobi6({ html: MOBI6_HTML, compression: 1 }), "mobi");
  assert.equal(parsed.coverBase64, null);
  assert.equal(parsed.coverMime, null);
  assert.equal(parsed.chapters.length, 2);
});

test("MOBI с DRM отклоняется", () => {
  const buffer = buildMobi6({ html: MOBI6_HTML, compression: 1 });
  const records = [buildRecord0({
    compression: 1,
    textLength: 100,
    numTextRecords: 1,
    resourceStart: 2,
    title: "x",
    exthRecords: [],
    encryption: 2,
  }), Buffer.from("<html></html>")];
  assert.throws(() => parseBook(buildPdb(records), "mobi"), /DRM/);
  assert.ok(buffer.length > 0);
});

test("KF8 (AZW3): скелет+фрагменты собираются в главы, метаданные из EXTH", () => {
  const parsed = parseBook(
    buildKf8([
      { skeleton: "<html><body><h1>Глава 1</h1></body></html>", fragment: "<p>Текст первой главы</p>" },
      { skeleton: "<html><body><h1>Глава 2</h1></body></html>", fragment: "<p>Текст второй главы</p>" },
    ]),
    "mobi",
  );

  assert.equal(parsed.title, "Синтетический KF8");
  assert.equal(parsed.author, "KF8 Автор");
  assert.equal(parsed.publicationYear, 2019);
  assert.equal(parsed.coverMime, "image/gif");

  assert.equal(parsed.chapters.length, 2);
  assert.deepEqual(parsed.chapters.map((c) => c.title), ["Глава 1", "Глава 2"]);
  assert.ok(parsed.chapters[0].htmlContent.includes("Текст первой главы"));
  assert.ok(parsed.chapters[1].htmlContent.includes("Текст второй главы"));
  assert.ok(parsed.chapters.every((c) => c.wordCount > 0));
});

test("validateBookFile отклоняет не-MOBI буфер", () => {
  assert.throws(() => validateBookFile(Buffer.from("not a mobi file at all.............."), "mobi"), /BOOKMOBI/);
});

// Словари в MOBI регулярно содержат >1500 секций (кейс Merriam-Webster's
// Vocabulary Builder — 2006 глав): лимит поднят до 3000 и не должен их отклонять.
function mobiWithChapterCount(count: number): Buffer {
  const parts: string[] = [];
  for (let i = 1; i <= count; i++) {
    parts.push(`<h1>Глава ${i}</h1><p>Содержание главы ${i}</p>`);
    if (i < count) parts.push("<mbp:pagebreak>");
  }
  return buildMobi6({ html: parts.join(""), compression: 1 });
}

test("MOBI со словарным числом глав (2000) парсится без ошибки", () => {
  const parsed = parseBook(mobiWithChapterCount(2000), "mobi");
  assert.equal(parsed.chapters.length, 2000);
  assert.equal(parsed.chapters[1999].title, "Глава 2000");
  assert.ok(parsed.chapters[1999].htmlContent.includes("Содержание главы 2000"));
});

test("MOBI с числом глав выше лимита отклоняется", () => {
  assert.throws(() => parseBook(mobiWithChapterCount(3001), "mobi"), /слишком много глав/);
});

// ─── Тесты TXT ───────────────────────────────────────────────────────────────

test("TXT: заголовок из первой строки, главы по маркерам «Глава N»", () => {
  const text = [
    "Моя тестовая книга",
    "",
    "Глава 1",
    "",
    "Текст первой главы.",
    "Несколько абзацев.",
    "",
    "Глава 2",
    "",
    "Текст второй главы.",
    "",
  ].join("\n");

  const parsed = parseBook(Buffer.from(text, "utf8"), "txt");
  assert.equal(parsed.title, "Моя тестовая книга");
  assert.deepEqual(parsed.chapters.map((c) => c.title), ["Глава 1", "Глава 2"]);
  assert.ok(parsed.chapters[0].htmlContent.includes("Текст первой главы."));
  assert.ok(parsed.chapters[0].htmlContent.includes("<p>"));
  assert.ok(parsed.chapters[1].wordCount > 0);
});

test("TXT без маркеров глав даёт одну главу", () => {
  const parsed = parseBook(Buffer.from("Просто сплошной текст без глав.\n\nВторой абзац.", "utf8"), "txt");
  assert.equal(parsed.chapters.length, 1);
  // Первая строка уходит в заголовок книги, глава начинается со следующего контента
  assert.equal(parsed.title, "Просто сплошной текст без глав.");
  assert.ok(parsed.chapters[0].htmlContent.includes("Второй абзац"));
});

test("TXT в Windows-1251 декодируется", () => {
  const cp1251: Record<string, number> = {};
  for (let i = 0; i < 32; i++) cp1251[String.fromCharCode(0x0410 + i)] = 0xc0 + i; // А-Я
  for (let i = 0; i < 32; i++) cp1251[String.fromCharCode(0x0430 + i)] = 0xe0 + i; // а-я
  cp1251["Ё"] = 0xa8;
  cp1251["ё"] = 0xb8;

  const encodeCp1251 = (text: string): Buffer =>
    Buffer.from([...text].map((ch) => cp1251[ch] ?? (ch.charCodeAt(0) < 128 ? ch.charCodeAt(0) : 0x3f)));

  const text = "Книга в кодировке\n\nГлава 1\n\nПривет, мир!";
  const parsed = parseBook(encodeCp1251(text), "txt");
  assert.equal(parsed.title, "Книга в кодировке");
  assert.ok(parsed.chapters[0].htmlContent.includes("Привет, мир!"));
});

// ─── Тесты Markdown ──────────────────────────────────────────────────────────

test("MD: заголовки #/## режут главы, разметка рендерится", () => {
  const md = [
    "# Моя markdown-книга",
    "",
    "## Глава 1",
    "",
    "Текст **первой** главы.",
    "",
    "## Глава 2",
    "",
    "- пункт один",
    "- пункт два",
    "",
  ].join("\n");

  const parsed = parseBook(Buffer.from(md, "utf8"), "md");
  assert.equal(parsed.title, "Моя markdown-книга");
  assert.deepEqual(parsed.chapters.map((c) => c.title), ["Глава 1", "Глава 2"]);
  assert.ok(parsed.chapters[0].htmlContent.includes("<strong>первой</strong>"));
  assert.ok(parsed.chapters[1].htmlContent.includes("<li>пункт один</li>"));
});

// ─── Тесты HTML ──────────────────────────────────────────────────────────────

test("HTML: главы по h1, скрипты и внешние картинки вырезаются", () => {
  const html = [
    "<html><head><title>HTML книга</title></head><body>",
    "<h1>Глава 1</h1><p>Текст первой</p><script>alert(1)</script>",
    "<h1>Глава 2</h1><p>Текст второй</p><img src=\"http://example.com/x.jpg\">",
    "</body></html>",
  ].join("");

  const parsed = parseBook(Buffer.from(html, "utf8"), "html");
  assert.equal(parsed.title, "HTML книга");
  assert.deepEqual(parsed.chapters.map((c) => c.title), ["Глава 1", "Глава 2"]);
  assert.ok(!parsed.chapters[0].htmlContent.includes("script"));
  assert.ok(!parsed.chapters[1].htmlContent.includes("<img"));
  assert.ok(parsed.chapters.every((c) => c.wordCount > 0));
});

// ─── Тесты CBZ ───────────────────────────────────────────────────────────────

test("CBZ: страницы группируются по 20, натуральная сортировка, обложка из первой страницы", () => {
  const zip = new AdmZip();
  for (let i = 1; i <= 25; i++) {
    const name = `page_${i}.gif`;
    zip.addFile(name, TINY_GIF);
  }
  // Файл-приманка не-картинка
  zip.addFile("info.txt", Buffer.from("not an image"));

  const parsed = parseBook(zip.toBuffer(), "cbz");
  assert.equal(parsed.chapters.length, 2);
  assert.equal(parsed.chapters[0].title, "Страницы 1–20");
  assert.equal(parsed.chapters[1].title, "Страницы 21–25");
  assert.equal(parsed.chapters[0].htmlContent.split("<img").length - 1, 20);
  assert.equal(parsed.chapters[1].htmlContent.split("<img").length - 1, 5);
  assert.equal(parsed.coverMime, "image/gif");
  assert.equal(parsed.coverBase64, TINY_GIF.toString("base64"));
});

test("CBZ с натуральной сортировкой: page_2 идёт перед page_10", () => {
  const zip = new AdmZip();
  zip.addFile("page_10.gif", Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
  zip.addFile("page_2.gif", Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"));
  const parsed = parseBook(zip.toBuffer(), "cbz");
  assert.equal(parsed.chapters.length, 1);
  assert.ok(parsed.chapters[0].htmlContent.indexOf("page_2") < parsed.chapters[0].htmlContent.indexOf("page_10"));
});

test("CBZ без картинок отклоняется", () => {
  const zip = new AdmZip();
  zip.addFile("readme.txt", Buffer.from("empty"));
  assert.throws(() => parseBook(zip.toBuffer(), "cbz"), /не содержит изображений/);
});

// ─── Диспетчеризация форматов ────────────────────────────────────────────────

test("parseBook отклоняет неизвестный формат и пустые файлы", () => {
  assert.throws(() => validateBookFile(Buffer.alloc(0), "txt"), /пустой/);
  assert.throws(() => validateBookFile(Buffer.from("PK".padEnd(64, "x")), "cbz"), /ZIP/);
});
