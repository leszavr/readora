import assert from "node:assert/strict";
import test from "node:test";
import { parseBook } from "../src/lib/parser";
import { optimizeImage } from "../src/lib/image-optimizer";

// Минимальный валидный JPEG 8x12 (sharp-generated).
const jpegBase64 =
  "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAMAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQb/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCcAAlK/9k=";

const coverFb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <book-title>Обложка из coverpage</book-title>
      <author><first-name>Иван</first-name><last-name>Автор</last-name></author>
      <coverpage><image l:href="#cover.jpg"/></coverpage>
      <lang>ru</lang>
    </title-info>
  </description>
  <body>
    <section><title><p>Глава 1</p></title><p>Текст первой главы достаточно длинный для парсера.</p></section>
  </body>
  <binary id="first-image.jpg" content-type="image/jpeg">${jpegBase64.slice(0, -4)}</binary>
  <binary id="cover.jpg" content-type="image/jpeg">${jpegBase64}</binary>
</FictionBook>`;

test("FB2 обложка берётся из coverpage, а не из первого binary", () => {
  // Падение до фикса: image объявлен массивом в isArray, обращение как к объекту
  // давало undefined, обложка выбиралась fallback-ом из binaries[0].
  const parsed = parseBook(Buffer.from(coverFb2, "utf8"), "fb2");
  // coverpage указывает на cover.jpg (полный jpegBase64); первый binary
  // отличается (обрезан) — если бы выбирался binaries[0], base64 не совпал бы.
  assert.equal(parsed.coverBase64, jpegBase64);
});

test("FB2 обложка без coverpage берёт первый binary", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <book-title>Без coverpage</book-title>
      <author><first-name>Иван</first-name><last-name>Автор</last-name></author>
    </title-info>
  </description>
  <body>
    <section><title><p>Глава 1</p></title><p>Текст первой главы достаточно длинный для парсера.</p></section>
  </body>
  <binary id="img.jpg" content-type="image/jpeg">${jpegBase64}</binary>
</FictionBook>`;
  const parsed = parseBook(Buffer.from(xml, "utf8"), "fb2");
  assert.ok(parsed.coverBase64);
  assert.equal(parsed.coverMime, "image/jpeg");
});

test("optimizeImage конвертирует обложку в WEBP", async () => {
  const jpegBuffer = Buffer.from(jpegBase64, "base64");
  const optimized = await optimizeImage(jpegBuffer, "cover");
  assert.equal(optimized.mimeType, "image/webp");
  assert.equal(optimized.extension, "webp");
  assert.equal(optimized.buffer.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(optimized.buffer.subarray(8, 12).toString("ascii"), "WEBP");
});
