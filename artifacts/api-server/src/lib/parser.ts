import { XMLParser } from "fast-xml-parser";
import AdmZip from "adm-zip";
import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import sanitizeHtml from "sanitize-html";
import path from "path";

const MAX_BOOK_PARSE_BYTES = 50 * 1024 * 1024;
const MAX_EPUB_ENTRIES = 3000;
const MAX_EPUB_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_EPUB_TEXT_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_FB2_XML_BYTES = 50 * 1024 * 1024;
const MAX_FB2_EMBEDDED_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_BOOK_CHAPTERS = 1500;
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

function sanitize(html: string): string {
  const clean = sanitizeHtml(html, SANITIZE_OPTIONS);
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

export function validateBookFile(buffer: Buffer, ext: "fb2" | "epub"): void {
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

export function parseBook(buffer: Buffer, ext: "fb2" | "epub"): ParsedBook {
  validateBookFile(buffer, ext);
  return ext === "fb2" ? parseFB2(buffer) : parseEPUB(buffer);
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

export function parseEPUB(buffer: Buffer): ParsedBook {
  validateBookFile(buffer, "epub");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();

  // Find container.xml -> content.opf path
  const containerXml = zip.readAsText("META-INF/container.xml");
  let opfPath = "content.opf";
  if (containerXml) {
    const m = containerXml.match(/full-path="([^"]+\.opf)"/);
    if (m) opfPath = m[1];
  }

  const opfEntry = entries.find((e) => e.entryName === opfPath || e.entryName.endsWith(".opf"));
  const opfText = opfEntry ? zip.readAsText(opfEntry.entryName) : "";
  const $ = cheerio.load(opfText, { xmlMode: true });

  const title = $("dc\\:title, title").first().text().trim() || "Без названия";
  const authorFull = $("dc\\:creator, creator").first().text().trim() || null;
  const description = $("dc\\:description, description").first().text().trim() || null;
  const language = $("dc\\:language, language").first().text().trim() || null;
  const genres = $("dc\\:subject, subject").map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const dateRaw = $("dc\\:date, date").first().text().trim();
  const m = dateRaw.match(/\d{4}/);
  const publicationYear = m ? parseInt(m[0], 10) : null;

  // Cover image
  let coverBase64: string | null = null;
  let coverMime: string | null = null;
  const coverId = $("meta[name='cover']").attr("content");
  const coverItem = coverId
    ? $(`item[id="${coverId}"]`)
    : $("item[media-type^='image']").first();
  if (coverItem.length) {
    const coverHref = coverItem.attr("href");
    if (coverHref) {
      const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";
      const coverPath = opfDir + coverHref;
      const coverEntry = entries.find((e) => e.entryName === coverPath || e.entryName.endsWith(coverHref));
      if (coverEntry) {
        coverBase64 = zip.readFile(coverEntry)?.toString("base64") ?? null;
        coverMime = coverItem.attr("media-type") ?? "image/jpeg";
      }
    }
  }

  const opfDir = opfPath.includes("/") ? opfPath.substring(0, opfPath.lastIndexOf("/") + 1) : "";

  const resolveEpubPath = (baseDir: string, href: string): string => {
    const hrefWithoutAnchor = href.split("#")[0] ?? "";
    const decodedHref = decodeURIComponent(hrefWithoutAnchor);
    return path.posix.normalize(path.posix.join(baseDir, decodedHref));
  };

  const manifest = new Map<string, { href: string; mediaType: string; properties: string }>();
  $("manifest item").each((_, el) => {
    const id = $(el).attr("id");
    const href = $(el).attr("href");
    if (!id || !href) return;
    manifest.set(id, {
      href,
      mediaType: $(el).attr("media-type") ?? "",
      properties: $(el).attr("properties") ?? "",
    });
  });

  // Spine order
  const spineIds: string[] = [];
  $("spine itemref").each((_, el) => {
    spineIds.push($(el).attr("idref") ?? "");
  });

  // NCX / nav for ToC titles
  const ncxId = $("spine").attr("toc");
  const ncxItem = ncxId ? $(`item[id="${ncxId}"]`) : $("item[media-type='application/x-dtbncx+xml']").first();
  const ncxHref = ncxItem.attr("href");
  const ncxTitles: Map<string, string> = new Map();
  if (ncxHref) {
    const ncxPath = resolveEpubPath(opfDir, ncxHref);
    const ncxEntry = entries.find((e) => e.entryName === ncxPath || e.entryName.endsWith(ncxHref));
    if (ncxEntry) {
      const ncxText = zip.readAsText(ncxEntry);
      const $ncx = cheerio.load(ncxText, { xmlMode: true });
      $ncx("navPoint").each((_, np) => {
        const label = $ncx(np).find("navLabel text").first().text().trim();
        const src = $ncx(np).find("content").attr("src") ?? "";
        const filePath = resolveEpubPath(opfDir, src);
        if (filePath && label) ncxTitles.set(filePath, label);
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
    const entry = entries.find((e) => e.entryName === entryPath || e.entryName.endsWith(href.split("/").pop() ?? ""));
    if (!entry) continue;

    const htmlText = zip.readAsText(entry);
    const readable = extractReadableEpubHtml(htmlText);
    const bodyHtml = readable.html || htmlText;
    const clean = sanitize(bodyHtml);

    const plainText = readable.text || cheerio.load(clean).text();
    const hasImages = /<img\b/i.test(bodyHtml);
    if (plainText.trim().length < 20 && !hasImages) continue;

    const chTitle = ncxTitles.get(entryPath) ?? (readable.title || `Глава ${chapterIndex + 1}`);

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
