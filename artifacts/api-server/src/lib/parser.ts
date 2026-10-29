import { XMLParser } from "fast-xml-parser";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import sanitizeHtml from "sanitize-html";
import { marked } from "marked";
import path from "path";
import { isMobiBuffer, parseMobiRaw } from "./mobi-parser";

const MAX_BOOK_PARSE_BYTES = 50 * 1024 * 1024;
const MAX_EPUB_ENTRIES = 3000;
const MAX_EPUB_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_EPUB_TEXT_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_FB2_XML_BYTES = 50 * 1024 * 1024;
const MAX_FB2_EMBEDDED_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_EPUB_EMBEDDED_IMAGE_BYTES = 10 * 1024 * 1024;
// Словари в MOBI/KF8 регулярно содержат >1500 секций (например, Merriam-Webster's
// Vocabulary Builder — 2006), поэтому лимит поднят с запасом; список глав в UI
// лёгкий (title + wordCount), вставка в БД — bulk.
const MAX_BOOK_CHAPTERS = 3000;
const MAX_TXT_BYTES = 20 * 1024 * 1024;
const MAX_CBZ_ENTRIES = 3000;
const MAX_CBZ_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const CBZ_PAGES_PER_CHAPTER = 20;

export type BookFormat = "fb2" | "epub" | "mobi" | "cbz" | "txt" | "md" | "html";

export const BOOK_FORMAT_EXTENSIONS: Record<string, BookFormat> = {
  ".fb2": "fb2",
  ".epub": "epub",
  ".mobi": "mobi",
  ".azw3": "mobi",
  ".prc": "mobi",
  ".cbz": "cbz",
  ".txt": "txt",
  ".md": "md",
  ".markdown": "md",
  ".html": "html",
  ".htm": "html",
};

export function bookFormatFromExtension(ext: string): BookFormat | null {
  return BOOK_FORMAT_EXTENSIONS[ext.toLowerCase()] ?? null;
}
const SAFE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const STRUCTURAL_FB2_SECTION_TITLES = new Set(["пролог", "эпилог"]);
const STRUCTURAL_FB2_SECTION_PREFIXES = new Set(["часть", "глава", "книга", "том", "раздел", "акт"]);
const STRUCTURAL_FB2_SECTION_ORDINALS = new Set([
  "первая",
  "вторая",
  "третья",
  "четвертая",
  "четвёртая",
  "пятая",
  "шестая",
  "седьмая",
  "восьмая",
  "девятая",
  "десятая",
  "одиннадцатая",
  "двенадцатая",
  "последняя",
]);

export interface ParsedBook {
  title: string;
  author: string | null;
  description: string | null;
  language: string | null;
  publicationYear: number | null;
  coverBase64: string | null;
  coverMime: string | null;
  genres: string[];
  chapters: ParsedChapter[];
}

export interface ParsedChapter {
  index: number;
  title: string;
  htmlContent: string;
  wordCount: number;
}

type Fb2Node = {
  type?: string;
  name?: string;
  tagName?: string;
  data?: string;
  children?: Fb2Node[];
  attribs?: Record<string, string | undefined>;
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "b",
    "strong",
    "i",
    "em",
    "del",
    "code",
    "br",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "a",
    "span",
    "div",
    "ul",
    "ol",
    "li",
    "blockquote",
    "sup",
    "sub",
    "img",
    "table",
    "thead",
    "tbody",
    "tr",
    "td",
    "th",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    blockquote: ["class"],
    div: ["class"],
    h4: ["class"],
    h5: ["class"],
    h6: ["class"],
    img: ["src", "alt", "class"],
    p: ["class"],
    span: ["class"],
    table: ["class"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    img: ["http", "https", "data"],
  },
  parseStyleAttributes: false,
};

// cheerio в xmlMode не знает HTML-сущности (`&nbsp;`, `&laquo;` ...) и отдаёт их
// как текст с экранированным амперсандом (`&amp;nbsp;`), из-за чего в читалке
// виден сам код сущности. Возвращаем entity-вид, чтобы sanitize-html их декодировал.
const XML_UNSAFE_NAMED_ENTITY = /&amp;(?!amp;|lt;|gt;|quot;|apos;)([a-zA-Z][a-zA-Z0-9]{1,31};)/g;

function normalizeHtmlEntities(html: string): string {
  return html.replace(XML_UNSAFE_NAMED_ENTITY, "&$1");
}

function sanitize(html: string): string {
  const clean = sanitizeHtml(normalizeHtmlEntities(html), SANITIZE_OPTIONS);
  const $ = cheerio.load(clean);

  $("img").each((_, image) => {
    const src = $(image).attr("src") ?? "";
    if (!isSafeImageSrc(src)) {
      $(image).remove();
    }
  });

  return $("body").html() ?? $.root().html() ?? "";
}

function isSafeImageSrc(src: string): boolean {
  const trimmed = src.trim();
  if (!trimmed) return false;
  if (/^data:/i.test(trimmed)) {
    return /^data:image\/(?:jpeg|png|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(trimmed);
  }
  return true;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countHtmlWords(html: string): number {
  return countWords(cheerio.load(html).text());
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean).join(" ");
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return textValue(obj["#text"] ?? obj.__cdata ?? obj.p ?? obj.v);
  }
  return "";
}

/**
 * Автоопределение кодировки и декодирование содержимого FB2 файла
 */
function detectAndConvertEncoding(fileBuffer: Buffer): string {
  const content = fileBuffer.toString('utf-8');
  const encodingMatch = /<?xml[^>]*encoding=["']([^"']+)["']/i.exec(content);
  const declaredEncoding = encodingMatch?.[1]?.toLowerCase();

  if (declaredEncoding && declaredEncoding !== 'utf-8' && declaredEncoding !== 'utf8') {
    return tryDecodeWithEncoding(fileBuffer, declaredEncoding, content);
  }

  if (hasEncodingIssues(content)) {
    return tryDecodeWindows1251(fileBuffer, content);
  }

  return content;
}

/**
 * Пытается декодировать с указанной кодировкой
 */
function tryDecodeWithEncoding(fileBuffer: Buffer, encoding: string, fallback: string): string {
  console.info(`[FB2Parser] Detected encoding from XML declaration: ${encoding}`);
  try {
    if (encoding === 'windows-1251' || encoding === 'cp1251') {
      return decodeWindows1251(fileBuffer);
    }
    console.warn(`[FB2Parser] Unsupported encoding: ${encoding}, using UTF-8 fallback`);
  } catch (error) {
    console.warn(`⚠️ [FB2Parser] Failed to decode with ${encoding}:`, error);
  }
  return fallback;
}

/**
 * Пытается декодировать из Windows-1251 с обработкой ошибок
 */
function tryDecodeWindows1251(fileBuffer: Buffer, fallback: string): string {
  console.warn('[FB2Parser] Detected encoding issues, trying Windows-1251 decode');
  try {
    return decodeWindows1251(fileBuffer);
  } catch (error) {
    console.warn(`⚠️ [FB2Parser] Windows-1251 decode failed, using original content:`, error);
    return fallback;
  }
}

/**
 * Проверяет наличие проблем с кодировкой (кракозябры или ромбики)
 */
function hasEncodingIssues(content: string): boolean {
  // Ищем характерные паттерны неправильной кодировки
  const badPatterns = [
    /Ð[À-ß]/g,  // Типичные кракозябры от неправильной кодировки
    /â€/g,       // Еще один паттерн
    /Ã[€¿]/g,    // Исправлено: отдельные символы вместо диапазона
  ];

  // Проверяем наличие ромбиков (replacement character) - признак невалидного UTF-8
  // Это происходит когда Win-1251 файл пытаются декодировать как UTF-8
  const hasReplacementChars = content.includes('\uFFFD');

  return hasReplacementChars || badPatterns.some(pattern => pattern.test(content));
}

/**
 * Декодирует содержимое из Windows-1251
 */
function decodeWindows1251(buffer: Buffer): string {
  // Полная таблица перекодировки Windows-1251 -> UTF-8 (включая все спецсимволы)
  const cp1251Map: { [key: number]: string } = {
    // Кириллица заглавные буквы (0xC0-0xDF)
    0xC0: 'А', 0xC1: 'Б', 0xC2: 'В', 0xC3: 'Г', 0xC4: 'Д', 0xC5: 'Е', 0xC6: 'Ж', 0xC7: 'З',
    0xC8: 'И', 0xC9: 'Й', 0xCA: 'К', 0xCB: 'Л', 0xCC: 'М', 0xCD: 'Н', 0xCE: 'О', 0xCF: 'П',
    0xD0: 'Р', 0xD1: 'С', 0xD2: 'Т', 0xD3: 'У', 0xD4: 'Ф', 0xD5: 'Х', 0xD6: 'Ц', 0xD7: 'Ч',
    0xD8: 'Ш', 0xD9: 'Щ', 0xDA: 'Ъ', 0xDB: 'Ы', 0xDC: 'Ь', 0xDD: 'Э', 0xDE: 'Ю', 0xDF: 'Я',
    // Кириллица строчные буквы (0xE0-0xFF)
    0xE0: 'а', 0xE1: 'б', 0xE2: 'в', 0xE3: 'г', 0xE4: 'д', 0xE5: 'е', 0xE6: 'ж', 0xE7: 'з',
    0xE8: 'и', 0xE9: 'й', 0xEA: 'к', 0xEB: 'л', 0xEC: 'м', 0xED: 'н', 0xEE: 'о', 0xEF: 'п',
    0xF0: 'р', 0xF1: 'с', 0xF2: 'т', 0xF3: 'у', 0xF4: 'ф', 0xF5: 'х', 0xF6: 'ц', 0xF7: 'ч',
    0xF8: 'ш', 0xF9: 'щ', 0xFA: 'ъ', 0xFB: 'ы', 0xFC: 'ь', 0xFD: 'э', 0xFE: 'ю', 0xFF: 'я',
    // Ё/ё
    0xA8: 'Ё', 0xB8: 'ё',
    // Специальные символы Windows-1251 (0x80-0xBF) - КРИТИЧЕСКИ ВАЖНО!
    0x80: '\u0402', 0x81: '\u0403', 0x82: '\u201A', 0x83: '\u0453', 0x84: '\u201E',
    0x85: '\u2026', // Многоточие ... (КРИТИЧНО!)
    0x86: '\u2020', 0x87: '\u2021', 0x88: '\u20AC', 0x89: '\u2030', 0x8A: '\u0409',
    0x8B: '\u2039', // Левая одиночная угловая кавычка ‹
    0x8C: '\u040A', 0x8D: '\u040C', 0x8E: '\u040B', 0x8F: '\u040F',
    0x90: '\u0452', 0x91: '\u2018', 0x92: '\u2019', 0x93: '\u201C', 0x94: '\u201D',
    0x95: '\u2022', // Буллет •
    0x96: '\u2013', // Короткое тире –
    0x97: '\u2014', // Длинное тире —
    0x98: '\u0098', 0x99: '\u2122', 0x9A: '\u0459',
    0x9B: '\u203A', // Правая одиночная угловая кавычка ›
    0x9C: '\u045A', 0x9D: '\u045C', 0x9E: '\u045B', 0x9F: '\u045F',
    0xA0: '\u00A0', // Неразрывный пробел
    0xA1: '\u040E', 0xA2: '\u045E', 0xA3: '\u0408', 0xA4: '\u00A4', 0xA5: '\u0490',
    0xA6: '\u00A6', 0xA7: '\u00A7', 0xA9: '\u00A9', 0xAA: '\u0404',
    0xAB: '\u00AB', // Левая кавычка-ёлочка « (КРИТИЧНО!)
    0xAC: '\u00AC', 0xAD: '\u00AD', 0xAE: '\u00AE', 0xAF: '\u0407',
    0xB0: '\u00B0', 0xB1: '\u00B1', 0xB2: '\u0406', 0xB3: '\u0456', 0xB4: '\u0491',
    0xB5: '\u00B5', 0xB6: '\u00B6', 0xB7: '\u00B7', 0xB9: '\u2116', // Номер №
    0xBA: '\u0454',
    0xBB: '\u00BB', // Правая кавычка-ёлочка » (КРИТИЧНО!)
    0xBC: '\u0458', 0xBD: '\u0405', 0xBE: '\u0455', 0xBF: '\u0457'
  };

  let result = '';
  for (const byte of buffer) {
    if (cp1251Map[byte]) {
      result += cp1251Map[byte];
    } else if (byte < 128) {
      // ASCII символы остаются как есть
      result += String.fromCodePoint(byte);
    } else {
      // Неизвестные символы заменяем на ?
      result += '?';
    }
  }

  return result;
}

function extractReadableEpubHtml(htmlText: string): { html: string; text: string; title: string | null } {
  const $xml = cheerio.load(htmlText, { xmlMode: true });
  $xml("script, style, header, footer, form, iframe, link, meta, button, input, textarea, select, nav[role='navigation'], nav[epub\\:type='toc'], nav[epub\\:type='landmarks'], [epub\\:type='pagebreak']").remove();

  const body = $xml("body").first();
  if (body.length) {
    const html = body.html()?.trim() ?? "";
    const text = body.text().trim();
    const title = $xml("h1, h2, h3, title").first().text().trim() || null;
    if (html || text) return { html, text, title };
  }

  const $html = cheerio.load(htmlText, { xmlMode: false });
  $html("script, style, header, footer, form, iframe, link, meta, button, input, textarea, select, nav[role='navigation'], nav[epub\\:type='toc'], nav[epub\\:type='landmarks'], [epub\\:type='pagebreak']").remove();
  const htmlBody = $html("body").first();
  return {
    html: (htmlBody.html() ?? $html.root().html() ?? htmlText).trim(),
    text: (htmlBody.text() || $html.root().text()).trim(),
    title: $html("h1, h2, h3, title").first().text().trim() || null,
  };
}

function isUnsafeZipPath(entryName: string): boolean {
  const normalized = path.posix.normalize(entryName.replaceAll("\\", "/"));
  return normalized.startsWith("../") || normalized === ".." || path.posix.isAbsolute(normalized);
}

export function validateBookFile(buffer: Buffer, ext: BookFormat): void {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error("Файл пустой");
  if (buffer.length > MAX_BOOK_PARSE_BYTES) throw new Error("Файл слишком большой");

  if (ext === "fb2") {
    if (buffer.length > MAX_FB2_XML_BYTES) throw new Error("FB2 превышает допустимый размер XML");
    const sample = detectAndConvertEncoding(buffer.subarray(0, Math.min(buffer.length, 4096)));
    if (!/<(?:\w+:)?FictionBook[\s>]/i.test(sample)) {
      throw new Error("Некорректный FB2: не найден корневой FictionBook");
    }
    return;
  }

  if (ext === "mobi") {
    if (!isMobiBuffer(buffer)) throw new Error("Некорректный MOBI: отсутствует сигнатура BOOKMOBI");
    return;
  }

  if (ext === "txt" || ext === "md") {
    if (buffer.length > MAX_TXT_BYTES) throw new Error("Текстовый файл превышает допустимый размер");
    return;
  }

  if (ext === "html") return;

  if (ext === "cbz") {
    if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("Некорректный CBZ: файл не является ZIP-архивом");
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (entries.length > MAX_CBZ_ENTRIES) throw new Error("CBZ содержит слишком много файлов");
    let totalUncompressed = 0;
    for (const entry of entries) {
      if (isUnsafeZipPath(entry.entryName)) throw new Error("CBZ содержит небезопасный путь файла");
      totalUncompressed += entry.header.size;
      if (totalUncompressed > MAX_CBZ_UNCOMPRESSED_BYTES) throw new Error("CBZ слишком большой после распаковки");
    }
    return;
  }

  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new Error("Некорректный EPUB: файл не является ZIP-архивом");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > MAX_EPUB_ENTRIES) throw new Error("EPUB содержит слишком много файлов");
  if (!entries.some((e) => e.entryName === "META-INF/container.xml")) {
    throw new Error("Некорректный EPUB: отсутствует META-INF/container.xml");
  }
  let totalUncompressed = 0;
  for (const entry of entries) {
    if (isUnsafeZipPath(entry.entryName)) throw new Error("EPUB содержит небезопасный путь файла");
    totalUncompressed += entry.header.size;
    if (totalUncompressed > MAX_EPUB_UNCOMPRESSED_BYTES) throw new Error("EPUB слишком большой после распаковки");
    if (/\.(x?html?|opf|ncx|xml)$/i.test(entry.entryName) && entry.header.size > MAX_EPUB_TEXT_ENTRY_BYTES) {
      throw new Error("EPUB содержит слишком большой текстовый файл");
    }
  }
}

export function parseBook(buffer: Buffer, ext: BookFormat): ParsedBook {
  validateBookFile(buffer, ext);
  switch (ext) {
    case "fb2":
      return parseFB2(buffer);
    case "epub":
      return parseEPUB(buffer);
    case "mobi":
      return parseMOBI(buffer);
    case "cbz":
      return parseCBZ(buffer);
    case "txt":
      return parseTXT(buffer);
    case "md":
      return parseMD(buffer);
    case "html":
      return parseHTML(buffer);
  }
}

// ─── FB2 Parser ───────────────────────────────────────────────────────────────

export function parseFB2(buffer: Buffer): ParsedBook {
  const xmlText = detectAndConvertEncoding(buffer);
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: true,
    parseAttributeValue: false,
    trimValues: true,
    cdataPropName: "__cdata",
    isArray: (name) =>
      ["section", "body", "binary", "genre", "author", "book-title", "p", "image", "title-info"].includes(name),
  });

  validateBookFile(buffer, "fb2");
  const doc = parser.parse(xmlText);
  const fb2 = doc?.FictionBook ?? doc?.fictionbook ?? {};

  const titleInfo = fb2?.description?.[0]?.["title-info"]?.[0] ?? fb2?.description?.["title-info"]?.[0] ?? fb2?.description?.["title-info"] ?? {};

  // Author
  const authors = toArray(titleInfo?.author)
    .map((authorRaw) => {
      const a = authorRaw as Record<string, unknown>;
      const firstName = textValue(a?.["first-name"]);
      const middleName = textValue(a?.["middle-name"]);
      const lastName = textValue(a?.["last-name"]);
      const nickname = textValue(a?.nickname);
      return [firstName, middleName, lastName].filter(Boolean).join(" ") || nickname;
    })
    .filter(Boolean);
  const author = authors.join(", ") || null;

  // Title
  const titleRaw = Array.isArray(titleInfo?.["book-title"]) ? titleInfo["book-title"][0] : titleInfo?.["book-title"];
  const title = (textValue(titleRaw) || "Без названия").trim();

  // Description
  const annotationRaw = titleInfo?.annotation;
  let description: string | null = null;
  if (annotationRaw) {
    description = textValue(annotationRaw).trim() || null;
  }

  // Language
  const language = textValue(titleInfo?.lang) || null;

  // Year
  const dateRaw = titleInfo?.date;
  let publicationYear: number | null = null;
  if (dateRaw) {
    const val = typeof dateRaw === "object" ? dateRaw?.["@_value"] ?? "" : String(dateRaw);
    const m = String(val).match(/\d{4}/);
    if (m) publicationYear = parseInt(m[0], 10);
  }

  // Genres
  const genreArr = Array.isArray(titleInfo?.genre) ? titleInfo.genre : titleInfo?.genre ? [titleInfo.genre] : [];
  const genres: string[] = genreArr.map((g: unknown) => textValue(g).trim()).filter(Boolean);

  // Cover image
  let coverBase64: string | null = null;
  let coverMime: string | null = null;
  const coverImageHref = titleInfo?.coverpage?.image?.["@_href"] ?? titleInfo?.coverpage?.image?.["@_l:href"];
  const binaries = Array.isArray(fb2?.binary) ? fb2.binary : fb2?.binary ? [fb2.binary] : [];
  if (coverImageHref) {
    const id = String(coverImageHref).replace("#", "");
    const bin = binaries.find((b: Record<string, string>) => b?.["@_id"] === id);
    if (bin) {
      coverBase64 = typeof bin?.["#text"] === "string" ? bin["#text"].replace(/\s+/g, "") : null;
      coverMime = bin?.["@_content-type"] ?? "image/jpeg";
    }
  }
  if (!coverBase64 && binaries.length > 0) {
    const bin = binaries[0] as Record<string, string>;
    if (bin?.["#text"]) {
      coverBase64 = bin["#text"].replace(/\s+/g, "");
      coverMime = bin?.["@_content-type"] ?? "image/jpeg";
    }
  }

  const chapters = extractFB2Chapters(xmlText);

  if (chapters.length === 0) {
    // fallback: whole book as one chapter
    const fallbackHtml = extractFB2FallbackBodyHtml(xmlText);
    const clean = sanitize(fallbackHtml);
    chapters.push({ index: 0, title: "Содержание", htmlContent: clean, wordCount: countHtmlWords(clean) });
  }

  return { title, author, description, language, publicationYear, coverBase64, coverMime, genres, chapters };
}

function nodeName(node: Fb2Node): string {
  return (node.name ?? node.tagName ?? "").toLowerCase();
}

function isElementNode(node: Fb2Node): boolean {
  return node.type === "tag" || Boolean(node.name ?? node.tagName);
}

function childElements(node: Fb2Node, name?: string): Fb2Node[] {
  return (node.children ?? []).filter((child) => {
    if (!isElementNode(child)) return false;
    return name ? nodeName(child) === name : true;
  });
}

function getAttr(node: Fb2Node, name: string): string | undefined {
  const attrs = node.attribs ?? {};
  return attrs[name] ?? Object.entries(attrs).find(([key]) => key === name || key.endsWith(`:${name}`))?.[1];
}

function renderTextFromNode(node: Fb2Node): string {
  if (node.type === "text" || node.type === "cdata") return node.data ?? "";
  return (node.children ?? []).map(renderTextFromNode).join("");
}

function isArabicOrRomanSectionMarker(value: string): boolean {
  return /^\d+[.)]?$/.test(value) || /^[ivxlcdm]+[.)]?$/i.test(value);
}

function isStructuralFb2SectionTitle(title: string): boolean {
  const normalized = title.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return true;
  if (STRUCTURAL_FB2_SECTION_TITLES.has(normalized)) return true;
  if (isArabicOrRomanSectionMarker(normalized)) return true;

  const [prefix, marker] = normalized.split(" ", 2);
  if (!prefix || !marker || !STRUCTURAL_FB2_SECTION_PREFIXES.has(prefix)) return false;
  return isArabicOrRomanSectionMarker(marker) || STRUCTURAL_FB2_SECTION_ORDINALS.has(marker);
}

function getFb2InlineChapterTitle(node: Fb2Node): string | null {
  if (nodeName(node) !== "p") return null;

  const elements = childElements(node);
  if (elements.length !== 1 || nodeName(elements[0]) !== "strong") return null;
  if ((node.children ?? []).some((child) => child.type === "text" && child.data?.trim())) return null;

  const title = renderTextFromNode(elements[0]).trim();
  const normalized = title.replace(/\s+/g, " ").toLowerCase();
  const marker = normalized.match(/^глава\s+(\S+)/)?.[1];
  return marker && (isArabicOrRomanSectionMarker(marker) || STRUCTURAL_FB2_SECTION_ORDINALS.has(marker))
    ? title
    : null;
}

function getFb2SectionTitle(section: Fb2Node): string | null {
  const title = childElements(section, "title")[0];
  if (!title) return null;

  const paragraphs = childElements(title, "p");
  if (paragraphs.length > 1) {
    const parts = paragraphs.map((p) => renderTextFromNode(p).trim()).filter(Boolean);
    return parts.length ? parts.join(". ") : null;
  }

  const text = renderTextFromNode(title).trim();
  return text || null;
}

function fallbackFb2SectionTitle(ancestorTitles: string[], chapterIndex: number, preferIntroLabel = false): string {
  const nearestAncestorTitle = [...ancestorTitles].reverse().find((title) => title.trim().length > 0);
  if (nearestAncestorTitle) return preferIntroLabel ? `${nearestAncestorTitle} — вступление` : nearestAncestorTitle;
  return `Глава ${chapterIndex + 1}`;
}

function shouldSplitFb2Section(section: Fb2Node, childSections: Fb2Node[], directWordCount: number): boolean {
  if (childSections.length === 0) return false;

  const titledChildren = childSections.filter((child) => Boolean(getFb2SectionTitle(child)?.trim()));
  if (titledChildren.length === 0) return false;

  const sectionTitle = getFb2SectionTitle(section);
  const isContainerLike = directWordCount < 80;
  const nonStructural = titledChildren.filter((child) => {
    const title = getFb2SectionTitle(child);
    return title ? !isStructuralFb2SectionTitle(title) : false;
  });
  const structural = titledChildren.filter((child) => {
    const title = getFb2SectionTitle(child);
    return title ? isStructuralFb2SectionTitle(title) : false;
  });

  if (childSections.length >= 2 && isContainerLike && nonStructural.length >= 2) return true;
  if (childSections.length >= 2 && isContainerLike && structural.length >= 1) return true;
  if (childSections.length === 1 && !sectionTitle && directWordCount < 30 && nonStructural.length === 1) return true;
  return false;
}

function appendFb2Chapter(chapters: ParsedChapter[], title: string, htmlContent: string): void {
  if (chapters.length >= MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");
  const clean = sanitize(htmlContent);
  const text = cheerio.load(clean).text();
  if (!text.trim() && !/<img\b/i.test(clean)) return;

  chapters.push({
    index: chapters.length,
    title,
    htmlContent: clean,
    wordCount: countWords(text),
  });
}

function appendFb2InlineChapters(
  section: Fb2Node,
  chapters: ParsedChapter[],
  binaryMap: Map<string, string>,
): boolean {
  const children = section.children ?? [];
  const headings = children
    .map((child, index) => ({ index, title: getFb2InlineChapterTitle(child) }))
    .filter((heading): heading is { index: number; title: string } => Boolean(heading.title));

  if (headings.length < 2) return false;

  for (const [headingIndex, heading] of headings.entries()) {
    const nextHeading = headings[headingIndex + 1];
    const content = children
      .slice(heading.index + 1, nextHeading?.index)
      .filter(isElementNode)
      .map((child) => renderFb2BlockElement(child, binaryMap))
      .join("");

    appendFb2Chapter(chapters, heading.title, `<h2>${escapeHtml(heading.title)}</h2>\n${content}`);
  }

  return true;
}

function appendFb2SectionChapters(
  section: Fb2Node,
  chapters: ParsedChapter[],
  chapterIndex: number,
  ancestorTitles: string[],
  binaryMap: Map<string, string>,
): number {
  if (chapters.length >= MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");

  const sectionTitle = getFb2SectionTitle(section);
  const childSections = childElements(section, "section");
  const directContent = renderFb2SectionOwnContent(section, binaryMap);
  const directWordCount = countHtmlWords(directContent);
  const nextAncestorTitles = sectionTitle?.trim() ? [...ancestorTitles, sectionTitle.trim()] : ancestorTitles;

  if (shouldSplitFb2Section(section, childSections, directWordCount)) {
    if (directWordCount >= 80) {
      appendFb2Chapter(
        chapters,
        sectionTitle || fallbackFb2SectionTitle(ancestorTitles, chapterIndex, true),
        directContent,
      );
      chapterIndex += 1;
    }

    for (const childSection of childSections) {
      chapterIndex = appendFb2SectionChapters(childSection, chapters, chapterIndex, nextAncestorTitles, binaryMap);
    }

    return chapterIndex;
  }

  if (childSections.length === 0 && appendFb2InlineChapters(section, chapters, binaryMap)) {
    return chapters.length;
  }

  const content = renderFb2SectionContent(section, binaryMap);
  if (content.trim()) {
    appendFb2Chapter(chapters, sectionTitle || fallbackFb2SectionTitle(ancestorTitles, chapterIndex, true), content);
    return chapterIndex + 1;
  }

  return chapterIndex;
}

function extractFB2Chapters(xmlText: string): ParsedChapter[] {
  const $ = cheerio.load(xmlText, { xmlMode: true });
  const binaryMap = buildFb2BinaryMap($);
  const chapters: ParsedChapter[] = [];
  let chapterIndex = 0;

  const bodies = $("FictionBook > body, fictionbook > body").toArray() as Fb2Node[];
  for (const body of bodies) {
    const bodyName = getAttr(body, "name")?.toLowerCase();
    if (bodyName === "notes" || bodyName === "comments") continue;

    for (const section of childElements(body, "section")) {
      chapterIndex = appendFb2SectionChapters(section, chapters, chapterIndex, [], binaryMap);
    }
  }

  return chapters;
}

function extractFB2FallbackBodyHtml(xmlText: string): string {
  const $ = cheerio.load(xmlText, { xmlMode: true });
  const binaryMap = buildFb2BinaryMap($);
  const bodies = $("FictionBook > body, fictionbook > body").toArray() as Fb2Node[];
  return bodies
    .filter((body) => {
      const bodyName = getAttr(body, "name")?.toLowerCase();
      return bodyName !== "notes" && bodyName !== "comments";
    })
    .map((body) => childElements(body).map((child) => renderFb2BlockElement(child, binaryMap)).join(""))
    .join("\n");
}

function renderFb2SectionOwnContent(section: Fb2Node, binaryMap: Map<string, string>): string {
  const parts: string[] = [];
  const title = getFb2SectionTitle(section);
  if (title) parts.push(`<h2>${escapeHtml(title)}</h2>\n`);

  for (const child of section.children ?? []) {
    if (!isElementNode(child)) continue;
    const name = nodeName(child);
    if (name === "title" || name === "section") continue;
    parts.push(renderFb2BlockElement(child, binaryMap));
  }

  return parts.join("");
}

function renderFb2SectionContent(section: Fb2Node, binaryMap: Map<string, string>): string {
  const parts: string[] = [];
  const title = getFb2SectionTitle(section);
  if (title) parts.push(`<h2>${escapeHtml(title)}</h2>\n`);

  for (const child of section.children ?? []) {
    if (!isElementNode(child)) continue;
    const name = nodeName(child);
    if (name === "title") continue;
    parts.push(name === "section" ? renderFb2SectionContent(child, binaryMap) : renderFb2BlockElement(child, binaryMap));
  }

  return parts.join("");
}

function renderFb2BlockElement(node: Fb2Node, binaryMap: Map<string, string>): string {
  switch (nodeName(node)) {
    case "p": {
      const content = renderFb2Inline(node, binaryMap).trim();
      return content ? `<p>${content}</p>\n` : "";
    }
    case "subtitle":
      return `<h3>${renderFb2Inline(node, binaryMap)}</h3>\n`;
    case "empty-line":
      return "<br>\n";
    case "epigraph":
      return renderFb2Quote(node, binaryMap, "epigraph");
    case "cite":
      return renderFb2Quote(node, binaryMap, "cite");
    case "annotation":
      return renderFb2Container(node, binaryMap, "annotation");
    case "poem":
      return renderFb2Poem(node, binaryMap);
    case "stanza":
      return renderFb2Stanza(node, binaryMap);
    case "table":
      return renderFb2Table(node, binaryMap);
    case "image":
      return renderFb2Image(node, binaryMap);
    case "text-author":
      return `<p class="text-author"><em>${renderFb2Inline(node, binaryMap)}</em></p>\n`;
    default: {
      const text = renderTextFromNode(node).trim();
      return text ? `<p>${escapeHtml(text)}</p>\n` : "";
    }
  }
}

function renderFb2Inline(node: Fb2Node, binaryMap: Map<string, string>): string {
  if (node.type === "text" || node.type === "cdata") return escapeHtml(node.data ?? "");

  let result = "";
  for (const child of node.children ?? []) {
    if (child.type === "text" || child.type === "cdata") {
      result += escapeHtml(child.data ?? "");
      continue;
    }
    if (!isElementNode(child)) continue;

    switch (nodeName(child)) {
      case "strong":
        result += `<strong>${renderFb2Inline(child, binaryMap)}</strong>`;
        break;
      case "emphasis":
        result += `<em>${renderFb2Inline(child, binaryMap)}</em>`;
        break;
      case "strikethrough":
        result += `<del>${renderFb2Inline(child, binaryMap)}</del>`;
        break;
      case "sub":
        result += `<sub>${renderFb2Inline(child, binaryMap)}</sub>`;
        break;
      case "sup":
        result += `<sup>${renderFb2Inline(child, binaryMap)}</sup>`;
        break;
      case "code":
        result += `<code>${renderFb2Inline(child, binaryMap)}</code>`;
        break;
      case "a":
        result += renderFb2Link(child, binaryMap);
        break;
      case "image":
        result += renderFb2Image(child, binaryMap);
        break;
      default:
        result += renderFb2Inline(child, binaryMap);
    }
  }
  return result;
}

function renderFb2Link(node: Fb2Node, binaryMap: Map<string, string>): string {
  const href = getAttr(node, "href") ?? "#";
  const content = renderFb2Inline(node, binaryMap) || escapeHtml(href.replace(/^#/, ""));
  return `<a href="${escapeHtml(href)}">${content}</a>`;
}

function renderFb2Image(node: Fb2Node, binaryMap: Map<string, string>): string {
  const href = getAttr(node, "href");
  if (!href) return "";

  const id = href.replace(/^#/, "");
  const src = binaryMap.get(id);
  if (!src) return "";

  const alt = getAttr(node, "alt") ?? "Иллюстрация";
  return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" class="fb2-image">\n`;
}

function renderFb2Quote(node: Fb2Node, binaryMap: Map<string, string>, className: string): string {
  return `<blockquote class="${className}">\n${renderFb2ContainerChildren(node, binaryMap)}</blockquote>\n`;
}

function renderFb2Container(node: Fb2Node, binaryMap: Map<string, string>, className: string): string {
  return `<div class="${className}">\n${renderFb2ContainerChildren(node, binaryMap)}</div>\n`;
}

function renderFb2ContainerChildren(node: Fb2Node, binaryMap: Map<string, string>): string {
  return (node.children ?? [])
    .filter(isElementNode)
    .map((child) => renderFb2BlockElement(child, binaryMap))
    .join("");
}

function renderFb2Poem(node: Fb2Node, binaryMap: Map<string, string>): string {
  const parts: string[] = ['<div class="poem">\n'];
  for (const child of childElements(node)) {
    switch (nodeName(child)) {
      case "title": {
        const title = renderTextFromNode(child).trim();
        if (title) parts.push(`<h4 class="poem-title">${escapeHtml(title)}</h4>\n`);
        break;
      }
      case "stanza":
        parts.push(renderFb2Stanza(child, binaryMap));
        break;
      case "text-author":
        parts.push(`<p class="text-author"><em>${renderFb2Inline(child, binaryMap)}</em></p>\n`);
        break;
      default:
        parts.push(renderFb2BlockElement(child, binaryMap));
    }
  }
  parts.push("</div>\n");
  return parts.join("");
}

function renderFb2Stanza(node: Fb2Node, binaryMap: Map<string, string>): string {
  const parts: string[] = ['<div class="stanza">\n'];
  for (const child of childElements(node)) {
    switch (nodeName(child)) {
      case "title": {
        const title = renderTextFromNode(child).trim();
        if (title) parts.push(`<h5 class="stanza-title">${escapeHtml(title)}</h5>\n`);
        break;
      }
      case "subtitle":
        parts.push(`<p class="stanza-subtitle"><em>${renderFb2Inline(child, binaryMap)}</em></p>\n`);
        break;
      case "v": {
        const verse = renderFb2Inline(child, binaryMap).trim();
        if (verse) parts.push(`<p class="verse">${verse}</p>\n`);
        break;
      }
      default:
        parts.push(renderFb2BlockElement(child, binaryMap));
    }
  }
  parts.push("</div>\n");
  return parts.join("");
}

function renderFb2Table(node: Fb2Node, binaryMap: Map<string, string>): string {
  const rows = childElements(node, "tr");
  const parts: string[] = ['<table class="fb2-table">\n<tbody>\n'];
  for (const row of rows) {
    parts.push("<tr>\n");
    for (const cell of childElements(row).filter((child) => nodeName(child) === "td" || nodeName(child) === "th")) {
      const tag = nodeName(cell) === "th" ? "th" : "td";
      const colspan = getPositiveIntegerAttr(cell, "colspan");
      const rowspan = getPositiveIntegerAttr(cell, "rowspan");
      const attrs = `${colspan ? ` colspan="${colspan}"` : ""}${rowspan ? ` rowspan="${rowspan}"` : ""}`;
      parts.push(`<${tag}${attrs}>${renderFb2Inline(cell, binaryMap)}</${tag}>\n`);
    }
    parts.push("</tr>\n");
  }
  parts.push("</tbody>\n</table>\n");
  return parts.join("");
}

function getPositiveIntegerAttr(node: Fb2Node, name: string): number | null {
  const value = getAttr(node, name);
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

function buildFb2BinaryMap($: CheerioAPI): Map<string, string> {
  const binaryMap = new Map<string, string>();
  const binaries = $("binary").toArray() as Fb2Node[];

  for (const binary of binaries) {
    const id = getAttr(binary, "id")?.trim();
    const contentType = getAttr(binary, "content-type")?.trim().toLowerCase() || "image/jpeg";
    const data = renderTextFromNode(binary).replace(/\s+/g, "");
    if (!id || !data || !SAFE_IMAGE_MIME_TYPES.has(contentType)) continue;

    const imageBytes = Buffer.byteLength(data, "base64");
    if (imageBytes > MAX_FB2_EMBEDDED_IMAGE_BYTES) continue;

    binaryMap.set(id, `data:${contentType};base64,${data}`);
  }

  return binaryMap;
}

// ─── EPUB Parser ──────────────────────────────────────────────────────────────

type XmlTag = {
  name?: string;
  tagName?: string;
  attribs?: Record<string, string | undefined>;
};

const EPUB_IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function xmlLocalName(node: XmlTag): string {
  return (node.name ?? node.tagName ?? "").split(":").pop()?.toLowerCase() ?? "";
}

// OPF/NCX часто используют пространства имён (`opf:item`, `opf:spine`), поэтому
// ищем элементы по локальному имени, а не по CSS-селектору с префиксом.
function elementsByLocalName(root: cheerio.Cheerio<any>, name: string) {
  const target = name.toLowerCase();
  return root.find("*").filter((_, el) => xmlLocalName(el as unknown as XmlTag) === target);
}

function attrsOf(node: unknown): Record<string, string | undefined> {
  return (node as XmlTag | undefined)?.attribs ?? {};
}

function firstAttr(node: unknown, ...names: string[]): string | undefined {
  const attrs = attrsOf(node);
  for (const name of names) {
    const value = attrs[name];
    if (value != null) return value;
  }
  return undefined;
}

function firstTextByLocalName(root: cheerio.Cheerio<any>, name: string): string {
  const el = elementsByLocalName(root, name).first();
  return el.length ? el.text().trim() : "";
}

interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string;
}

interface EpubTocEntry {
  title: string;
  anchor: string | null;
}

function hasReadableEpubContent(html: string): boolean {
  if (/<img\b/i.test(html)) return true;
  return cheerio.load(html).text().trim().length > 0;
}

function serializeEpubSlice($doc: CheerioAPI, nodes: unknown[]): string {
  if (nodes.length === 0) return "";
  const holder = $doc("<div></div>");
  holder.append(nodes as never);
  return holder.html() ?? "";
}

// Относительные ссылки на изображения (`images/1.jpg`) в ридере не работают:
// HTML отдаётся как есть, без доступа к файлам EPUB. Встраиваем их как data URI.
function inlineEpubImages(
  html: string,
  docDir: string,
  zip: AdmZip,
  entries: AdmZip.IZipEntry[],
): string {
  if (!/<img\b/i.test(html)) return html;

  const $doc = cheerio.load(html, { xmlMode: false });
  let changed = false;

  $doc("img").each((_, el) => {
    const src = ($doc(el).attr("src") ?? "").trim();
    if (!src || /^data:/i.test(src)) return;

    // Внешние картинки не встраиваем: CDN источников часто недоступны, а
    // загрузка с чужого хоста раскрывает третьей стороне факт чтения книги.
    if (/^(?:https?:)?\/\//i.test(src)) {
      $doc(el).remove();
      changed = true;
      return;
    }

    const rawSrc = src.split("#")[0] ?? "";
    let decodedSrc = rawSrc;
    try {
      decodedSrc = decodeURIComponent(rawSrc);
    } catch {
      decodedSrc = rawSrc;
    }

    const resolved = path.posix.normalize(path.posix.join(docDir, decodedSrc));
    const mime = EPUB_IMAGE_MIME_BY_EXT[path.posix.extname(resolved).toLowerCase()];
    const entry = isUnsafeZipPath(resolved) ? undefined : entries.find((e) => e.entryName === resolved);
    const data = entry && mime && entry.header.size <= MAX_EPUB_EMBEDDED_IMAGE_BYTES ? zip.readFile(entry) : null;

    if (!data || !mime) {
      $doc(el).remove();
      changed = true;
      return;
    }

    $doc(el).attr("src", `data:${mime};base64,${data.toString("base64")}`);
    changed = true;
  });

  if (!changed) return html;
  return $doc("body").html() ?? $doc.root().html() ?? html;
}

// Некоторые EPUB (например, экспорт Google Docs) содержат всю книгу одним
// XHTML-файлом, а главы размечены только якорями в TOC. Режем документ по
// якорям на отдельные главы.
function splitEpubHtmlByToc(
  htmlText: string,
  tocEntries: EpubTocEntry[],
): Array<{ title: string; html: string }> | null {
  if (tocEntries.filter((entry) => entry.anchor).length < 2) return null;

  const $doc = cheerio.load(htmlText, { xmlMode: true });
  $doc("script, style, header, footer, form, iframe, link, meta, button, input, textarea, select, [epub\\:type='pagebreak']").remove();

  const body = $doc("body").first();
  if (!body.length) return null;

  const bodyEl = body.get(0);
  const children = body.children().toArray();
  if (children.length === 0) return null;

  const cuts = new Map<number, string>();
  for (const entry of tocEntries) {
    if (!entry.anchor) continue;
    const selector = `[id="${entry.anchor.replace(/["\\]/g, "\\$&")}"]`;
    const target = $doc(selector).first();
    if (!target.length) continue;

    let node: any = target.get(0);
    while (node && node.parent && node.parent !== bodyEl) node = node.parent;
    if (!node || node.parent !== bodyEl) continue;

    const index = children.indexOf(node);
    if (index < 0 || cuts.has(index)) continue;
    cuts.set(index, entry.title);
  }

  if (cuts.size < 2) return null;

  const starts = [...cuts.keys()].sort((a, b) => a - b);
  const result: Array<{ title: string; html: string }> = [];

  for (let i = 0; i < starts.length; i += 1) {
    // Контент до первого якоря (титульная страница, обложка) присоединяем к
    // первой главе, чтобы не создавать дубль с тем же названием.
    const start = i === 0 ? 0 : starts[i];
    const end = starts[i + 1] ?? children.length;
    const html = serializeEpubSlice($doc, children.slice(start, end));
    if (!hasReadableEpubContent(html)) continue;
    result.push({ title: cuts.get(starts[i]) ?? `Глава ${result.length + 1}`, html });
  }

  return result.length >= 2 ? result : null;
}

export function parseEPUB(buffer: Buffer): ParsedBook {
  validateBookFile(buffer, "epub");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  const findEntry = (entryPath: string, href: string) => {
    const exact = entries.find((e) => e.entryName === entryPath);
    if (exact) return exact;
    const basename = href.split("/").pop() ?? "";
    return basename ? entries.find((e) => e.entryName.endsWith(basename)) : undefined;
  };

  // container.xml -> content.opf
  const containerXml = zip.readAsText("META-INF/container.xml");
  let opfPath = "content.opf";
  if (containerXml) {
    const m = containerXml.match(/full-path="([^"]+\.opf)"/);
    if (m) opfPath = m[1];
  }
  const opfEntry = entries.find((e) => e.entryName === opfPath) ?? entries.find((e) => e.entryName.endsWith(".opf"));
  const opfText = opfEntry ? zip.readAsText(opfEntry) : "";
  const opfDir =
    opfEntry && opfEntry.entryName.includes("/")
      ? opfEntry.entryName.substring(0, opfEntry.entryName.lastIndexOf("/") + 1)
      : "";
  const $ = cheerio.load(opfText, { xmlMode: true });

  const resolveEpubPath = (baseDir: string, href: string): string => {
    const hrefWithoutAnchor = href.split("#")[0] ?? "";
    let decodedHref = hrefWithoutAnchor;
    try {
      decodedHref = decodeURIComponent(hrefWithoutAnchor);
    } catch {
      decodedHref = hrefWithoutAnchor;
    }
    return path.posix.normalize(path.posix.join(baseDir, decodedHref));
  };

  const dirOf = (filePath: string): string => {
    const dir = path.posix.dirname(filePath);
    return dir === "." ? "" : `${dir}/`;
  };

  // Metadata
  const title = firstTextByLocalName($.root(), "title") || "Без названия";
  const authorFull = firstTextByLocalName($.root(), "creator") || null;
  const description = firstTextByLocalName($.root(), "description") || null;
  const language = firstTextByLocalName($.root(), "language") || null;
  const genres = elementsByLocalName($.root(), "subject")
    .toArray()
    .map((el) => $(el).text().trim())
    .filter(Boolean);
  const dateRaw = firstTextByLocalName($.root(), "date");
  const yearMatch = dateRaw.match(/\d{4}/);
  const publicationYear = yearMatch ? parseInt(yearMatch[0], 10) : null;

  // В некоторых EPUB заголовки в TOC содержат служебные префиксы вида
  // "8 Название книги Глава 8. ...". Убираем их для читаемого оглавления.
  const normalizeChapterTitle = (raw: string): string => {
    let value = raw.trim();
    if (!value) return value;
    if (title && title !== "Без названия") {
      const index = value.toLowerCase().indexOf(title.toLowerCase());
      if (index >= 0 && index + title.length < value.length) {
        const rest = value.slice(index + title.length).trim();
        if (rest) value = rest;
      }
    }
    value = value.replace(/^\d+[.)]?\s+(?=глава\b)/i, "").trim();
    return value || raw.trim();
  };

  // Manifest
  const manifest = new Map<string, EpubManifestItem>();
  for (const el of elementsByLocalName($.root(), "item").toArray()) {
    const id = firstAttr(el, "id");
    const href = firstAttr(el, "href");
    if (!id || !href) continue;
    manifest.set(id, {
      id,
      href,
      mediaType: (firstAttr(el, "media-type", "media_type") ?? "").toLowerCase(),
      properties: firstAttr(el, "properties") ?? "",
    });
  }
  const manifestItems = [...manifest.values()];

  // Cover
  let coverBase64: string | null = null;
  let coverMime: string | null = null;
  const coverMeta = elementsByLocalName($.root(), "meta")
    .toArray()
    .find((el) => firstAttr(el, "name") === "cover");
  const coverId = coverMeta ? firstAttr(coverMeta, "content") : undefined;
  const coverItem =
    (coverId ? manifest.get(coverId) : undefined) ??
    manifestItems.find((item) => /\bcover-image\b/.test(item.properties)) ??
    manifestItems.find((item) => item.mediaType.startsWith("image/"));
  if (coverItem) {
    const coverPath = resolveEpubPath(opfDir, coverItem.href);
    const coverEntry = findEntry(coverPath, coverItem.href);
    if (coverEntry) {
      coverBase64 = zip.readFile(coverEntry)?.toString("base64") ?? null;
      coverMime =
        coverItem.mediaType ||
        EPUB_IMAGE_MIME_BY_EXT[path.posix.extname(coverPath).toLowerCase()] ||
        "image/jpeg";
    }
  }

  // Spine order
  const spineIds = elementsByLocalName($.root(), "itemref")
    .toArray()
    .map((el) => firstAttr(el, "idref") ?? "")
    .filter(Boolean);
  const spineEl = elementsByLocalName($.root(), "spine").first();
  const ncxId = spineEl.length ? firstAttr(spineEl.get(0), "toc") : undefined;

  // TOC: NCX и EPUB3 nav, с привязкой якорей к файлам
  const tocByFile = new Map<string, EpubTocEntry[]>();
  const addTocEntry = (filePath: string, tocTitle: string, anchor: string | null) => {
    if (!filePath) return;
    const normalizedTitle = normalizeChapterTitle(tocTitle);
    const list = tocByFile.get(filePath) ?? [];
    if (!list.some((entry) => entry.anchor === anchor && entry.title === normalizedTitle)) {
      list.push({ title: normalizedTitle, anchor });
      tocByFile.set(filePath, list);
    }
  };

  const ncxItem =
    (ncxId ? manifest.get(ncxId) : undefined) ??
    manifestItems.find((item) => item.mediaType === "application/x-dtbncx+xml");
  if (ncxItem) {
    const ncxPath = resolveEpubPath(opfDir, ncxItem.href);
    const ncxEntry = findEntry(ncxPath, ncxItem.href);
    if (ncxEntry) {
      const $ncx = cheerio.load(zip.readAsText(ncxEntry), { xmlMode: true });
      const ncxDir = dirOf(ncxPath);
      for (const navPoint of elementsByLocalName($ncx.root(), "navPoint").toArray()) {
        const scope = $ncx(navPoint);
        const label =
          elementsByLocalName(scope, "text").first().text().trim() ||
          elementsByLocalName(scope, "navLabel").first().text().trim();
        const src = firstAttr(elementsByLocalName(scope, "content").first().get(0), "src") ?? "";
        if (!label || !src) continue;
        const [rawPath, anchor] = src.split("#");
        addTocEntry(resolveEpubPath(ncxDir, rawPath ?? ""), label, anchor || null);
      }
    }
  }

  const navItem = manifestItems.find((item) => /\bnav\b/.test(item.properties));
  if (navItem) {
    const navPath = resolveEpubPath(opfDir, navItem.href);
    const navEntry = findEntry(navPath, navItem.href);
    if (navEntry) {
      const $nav = cheerio.load(zip.readAsText(navEntry), { xmlMode: true });
      const navDir = dirOf(navPath);
      const navs = elementsByLocalName($nav.root(), "nav").toArray();
      const tocNav =
        navs.find((el) => (firstAttr(el, "epub:type", "type") ?? "").toLowerCase() === "toc") ?? navs[0];
      const scope: cheerio.Cheerio<any> = tocNav ? $nav(tocNav) : $nav.root();
      scope.find("a[href]").each((_, link) => {
        const href = $nav(link).attr("href") ?? "";
        const label = $nav(link).text().trim();
        if (!href || !label) return;
        const [rawPath, anchor] = href.split("#");
        addTocEntry(resolveEpubPath(navDir, rawPath ?? ""), label, anchor || null);
      });
    }
  }

  const chapters: ParsedChapter[] = [];
  let chapterIndex = 0;

  for (const idref of spineIds) {
    if (!idref) continue;
    const item = manifest.get(idref);
    if (!item) continue;
    const { href } = item;
    const mime = item.mediaType;
    if (!mime.includes("html") && !mime.includes("xhtml")) continue;
    if (/\b(nav|toc|cover|titlepage|frontmatter)\b/i.test(item.properties)) continue;

    const entryPath = resolveEpubPath(opfDir, href);
    const entry = findEntry(entryPath, href);
    if (!entry) continue;

    const htmlText = zip.readAsText(entry);
    const docDir = dirOf(entryPath);

    const split = splitEpubHtmlByToc(htmlText, tocByFile.get(entryPath) ?? []);
    if (split) {
      for (const part of split) {
        const clean = sanitize(inlineEpubImages(part.html, docDir, zip, entries));
        const text = cheerio.load(clean).text();
        if (!text.trim() && !/<img\b/i.test(clean)) continue;
        chapters.push({
          index: chapterIndex++,
          title: part.title,
          htmlContent: clean,
          wordCount: countWords(text),
        });
        if (chapters.length > MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");
      }
      continue;
    }

    const readable = extractReadableEpubHtml(htmlText);
    const bodyHtml = readable.html || htmlText;
    const clean = sanitize(inlineEpubImages(bodyHtml, docDir, zip, entries));

    const plainText = readable.text || cheerio.load(clean).text();
    const hasImages = /<img\b/i.test(clean);
    if (!plainText.trim() && !hasImages) continue;

    const chTitle =
      tocByFile.get(entryPath)?.find((tocEntry) => tocEntry.title)?.title ??
      (readable.title ? normalizeChapterTitle(readable.title) : `Глава ${chapterIndex + 1}`);

    chapters.push({
      index: chapterIndex++,
      title: chTitle,
      htmlContent: clean,
      wordCount: countWords(plainText),
    });
    if (chapters.length > MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");
  }

  if (chapters.length === 0) {
    const firstHtml = entries.find((e) => e.entryName.endsWith(".html") || e.entryName.endsWith(".xhtml"));
    if (firstHtml) {
      const readable = extractReadableEpubHtml(zip.readAsText(firstHtml));
      const html = sanitize(readable.html);
      chapters.push({ index: 0, title: readable.title || "Содержание", htmlContent: html, wordCount: countWords(readable.text || html) });
    }
  }

  return { title, author: authorFull, description, language, publicationYear, coverBase64, coverMime, genres, chapters };
}

// ─── MOBI Parser ──────────────────────────────────────────────────────────────

function parseMOBI(buffer: Buffer): ParsedBook {
  const raw = parseMobiRaw(buffer);
  const chapters: ParsedChapter[] = [];
  for (const chapter of raw.chapters) {
    if (chapters.length >= MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");
    const clean = sanitize(removeNonDataImages(chapter.html));
    const text = cheerio.load(clean).text();
    if (!text.trim() && !/<img\b/i.test(clean)) continue;
    chapters.push({ index: chapters.length, title: chapter.title, htmlContent: clean, wordCount: countWords(text) });
  }
  if (chapters.length === 0) throw new Error("MOBI не содержит читаемого текста");
  return {
    title: raw.title,
    author: raw.author,
    description: raw.description,
    language: raw.language,
    publicationYear: raw.publicationYear,
    coverBase64: raw.coverBase64,
    coverMime: raw.coverMime,
    genres: raw.genres,
    chapters,
  };
}

// ─── TXT Parser ───────────────────────────────────────────────────────────────

const TXT_CHAPTER_HEADING = /^(?:Глава|ГЛАВА|Chapter|CHAPTER|Часть|ЧАСТЬ|Part|PART)\s+\S.*$/;

function decodeTxtBuffer(buffer: Buffer): string {
  const content = buffer.toString("utf-8");
  if (hasEncodingIssues(content)) {
    try {
      return decodeWindows1251(buffer);
    } catch {
      return content;
    }
  }
  return content;
}

function parseTXT(buffer: Buffer): ParsedBook {
  const text = decodeTxtBuffer(buffer);
  const lines = text.split(/\r?\n/);

  let titleLineIndex = -1;
  let title = "Без названия";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.length <= 120) {
      title = line;
      titleLineIndex = i;
    }
    break;
  }

  const contentLines = titleLineIndex >= 0 ? lines.slice(titleLineIndex + 1) : lines;

  const chapterStarts: Array<{ index: number; title: string }> = [];
  for (let i = 0; i < contentLines.length; i++) {
    const line = contentLines[i].trim();
    if (TXT_CHAPTER_HEADING.test(line)) chapterStarts.push({ index: i, title: line });
  }

  const chapters: ParsedChapter[] = [];
  const pushChapter = (chapterTitle: string, chapterLines: string[]) => {
    if (chapters.length >= MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");
    const paragraphs = chapterLines
      .join("\n")
      .split(/\n\s*\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`);
    if (paragraphs.length === 0) return;
    const html = `<h2>${escapeHtml(chapterTitle)}</h2>\n${paragraphs.join("\n")}`;
    chapters.push({ index: chapters.length, title: chapterTitle, htmlContent: html, wordCount: countWords(chapterLines.join(" ")) });
  };

  if (chapterStarts.length >= 2) {
    for (let i = 0; i < chapterStarts.length; i++) {
      const start = chapterStarts[i].index;
      const end = i + 1 < chapterStarts.length ? chapterStarts[i + 1].index : contentLines.length;
      pushChapter(chapterStarts[i].title, contentLines.slice(start + 1, end));
    }
  } else {
    pushChapter("Текст", contentLines);
  }

  if (chapters.length === 0) throw new Error("TXT не содержит читаемого текста");
  return { title, author: null, description: null, language: null, publicationYear: null, coverBase64: null, coverMime: null, genres: [], chapters };
}

// ─── Markdown Parser ──────────────────────────────────────────────────────────

const MD_HEADING = /^(#{1,2})\s+(.+)$/;

function parseMD(buffer: Buffer): ParsedBook {
  const text = decodeTxtBuffer(buffer);
  const lines = text.split(/\r?\n/);

  const headings: Array<{ line: number; level: number; title: string }> = [];
  lines.forEach((line, i) => {
    const match = line.match(MD_HEADING);
    if (match) headings.push({ line: i, level: match[1].length, title: match[2].trim() });
  });

  const firstNonEmpty = lines.findIndex((line) => line.trim() !== "");
  // Единственный h1 в самом начале документа — название книги, а не глава.
  const titleHeading =
    headings.length > 0 &&
    headings[0].level === 1 &&
    headings[0].line === firstNonEmpty &&
    headings.filter((heading) => heading.level === 1).length === 1
      ? headings[0]
      : null;

  const title = titleHeading
    ? titleHeading.title.slice(0, 120)
    : firstNonEmpty >= 0
      ? lines[firstNonEmpty].replace(/^#{1,6}\s+/, "").trim().slice(0, 120) || "Без названия"
      : "Без названия";

  const chapterHeadings = titleHeading ? headings.slice(1) : headings;
  const renderChunk = (chunk: string): string => sanitize(marked.parse(chunk, { async: false }) as string);

  const chapters: ParsedChapter[] = [];
  if (chapterHeadings.length >= 2) {
    for (let i = 0; i < chapterHeadings.length; i++) {
      if (chapters.length >= MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");
      const start = chapterHeadings[i].line;
      const end = i + 1 < chapterHeadings.length ? chapterHeadings[i + 1].line : lines.length;
      const html = renderChunk(lines.slice(start, end).join("\n"));
      const plain = cheerio.load(html).text();
      if (!plain.trim()) continue;
      chapters.push({ index: chapters.length, title: chapterHeadings[i].title, htmlContent: html, wordCount: countWords(plain) });
    }
  } else {
    const html = renderChunk(text);
    const plain = cheerio.load(html).text();
    if (!plain.trim()) throw new Error("Markdown не содержит читаемого текста");
    chapters.push({ index: 0, title: title === "Без названия" ? "Текст" : title, htmlContent: html, wordCount: countWords(plain) });
  }

  if (chapters.length === 0) throw new Error("Markdown не содержит читаемого текста");
  return { title, author: null, description: null, language: null, publicationYear: null, coverBase64: null, coverMime: null, genres: [], chapters };
}

// ─── HTML Parser ──────────────────────────────────────────────────────────────

function parseHTML(buffer: Buffer): ParsedBook {
  const htmlText = decodeTxtBuffer(buffer);
  const readable = extractReadableEpubHtml(htmlText);
  const title = readable.title?.slice(0, 120) || "Без названия";

  const $ = cheerio.load(readable.html || htmlText, { xmlMode: false });
  $("script, style, header, footer, form, iframe, link, meta, button, input, textarea, select, nav").remove();
  const children = $("body").children().toArray();

  const chapters: ParsedChapter[] = [];
  const pushChapter = (chapterTitle: string, nodes: unknown[]) => {
    if (chapters.length >= MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");
    if (nodes.length === 0) return;
    const html = removeNonDataImages(serializeEpubSlice($, nodes));
    const clean = sanitize(html);
    const plain = cheerio.load(clean).text();
    if (!plain.trim() && !/<img\b/i.test(clean)) return;
    chapters.push({ index: chapters.length, title: chapterTitle, htmlContent: clean, wordCount: countWords(plain) });
  };

  const headingIndexes = children
    .map((node, index) => ({ index, el: node as { tagName?: string } }))
    .filter(({ el }) => /^h[12]$/i.test(el.tagName ?? ""))
    .map(({ index }) => index);

  if (headingIndexes.length >= 2) {
    if (headingIndexes[0] > 0) pushChapter(title, children.slice(0, headingIndexes[0]));
    for (let i = 0; i < headingIndexes.length; i++) {
      const start = headingIndexes[i];
      const end = i + 1 < headingIndexes.length ? headingIndexes[i + 1] : children.length;
      const headingText = $(children[start]).text().trim();
      pushChapter(headingText || `Глава ${chapters.length + 1}`, children.slice(start, end));
    }
  } else {
    pushChapter(title, children);
  }

  if (chapters.length === 0) throw new Error("HTML не содержит читаемого текста");
  return { title, author: null, description: null, language: null, publicationYear: null, coverBase64: null, coverMime: null, genres: [], chapters };
}

// ─── CBZ Parser ───────────────────────────────────────────────────────────────

const CBZ_IMAGE_MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const naturalCompare = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" }).compare;

function parseCBZ(buffer: Buffer): ParsedBook {
  const zip = new AdmZip(buffer);
  const pages = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && CBZ_IMAGE_MIME_BY_EXT[path.posix.extname(entry.entryName).toLowerCase()] != null)
    .sort((a, b) => naturalCompare(a.entryName, b.entryName));

  if (pages.length === 0) throw new Error("CBZ не содержит изображений");

  const coverEntry = pages[0];
  const coverMime = CBZ_IMAGE_MIME_BY_EXT[path.posix.extname(coverEntry.entryName).toLowerCase()];
  const coverData = coverEntry.header.size <= MAX_EPUB_EMBEDDED_IMAGE_BYTES ? zip.readFile(coverEntry) : null;

  const chapters: ParsedChapter[] = [];
  for (let start = 0; start < pages.length; start += CBZ_PAGES_PER_CHAPTER) {
    if (chapters.length >= MAX_BOOK_CHAPTERS) throw new Error("Книга содержит слишком много глав");
    const group = pages.slice(start, start + CBZ_PAGES_PER_CHAPTER);
    const images: string[] = [];
    for (const entry of group) {
      if (entry.header.size > MAX_EPUB_EMBEDDED_IMAGE_BYTES) continue;
      const mime = CBZ_IMAGE_MIME_BY_EXT[path.posix.extname(entry.entryName).toLowerCase()];
      const data = zip.readFile(entry);
      if (!data || data.length === 0) continue;
      images.push(`<img src="data:${mime};base64,${data.toString("base64")}" alt="Страница ${entry.entryName}" class="cbz-page">`);
    }
    if (images.length === 0) continue;
    const pageNumber = start + 1;
    const endPage = start + images.length;
    const chapterTitle = images.length === 1 ? `Страница ${pageNumber}` : `Страницы ${pageNumber}–${endPage}`;
    chapters.push({
      index: chapters.length,
      title: chapterTitle,
      htmlContent: images.join("\n"),
      wordCount: 0,
    });
  }

  if (chapters.length === 0) throw new Error("CBZ не содержит читаемых изображений");
  return {
    title: "Без названия",
    author: null,
    description: null,
    language: null,
    publicationYear: null,
    coverBase64: coverData?.toString("base64") ?? null,
    coverMime: coverData ? coverMime : null,
    genres: [],
    chapters,
  };
}

// Внешние и неразрешимые картинки (kindle:, относительные пути) не встраиваем:
// загрузка с чужого хоста раскрывает третьей стороне факт чтения книги.
function removeNonDataImages(html: string): string {
  if (!/<img\b/i.test(html)) return html;
  const $ = cheerio.load(html, { xmlMode: false });
  let changed = false;
  $("img").each((_, el) => {
    const src = ($(el).attr("src") ?? "").trim();
    if (!src || !/^data:/i.test(src)) {
      $(el).remove();
      changed = true;
    }
  });
  if (!changed) return html;
  return $("body").html() ?? $.root().html() ?? html;
}
