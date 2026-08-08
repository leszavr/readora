import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import multer from "multer";
import nodemailer from "nodemailer";
import sharp from "sharp";
import { optimizeImage } from "../src/lib/image-optimizer";
import { parseBook, validateBookFile } from "../src/lib/parser";
import { createPublicBookCover } from "../src/lib/public-book-cover-service";

const fb2 = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<FictionBook>
  <description>
    <title-info>
      <book-title>Test FB2</book-title>
      <author><first-name>Test</first-name><last-name>Author</last-name></author>
      <lang>en</lang>
    </title-info>
  </description>
  <body>
    <section><title><p>Chapter one</p></title><p>This is enough text to be parsed as a readable chapter in the test book.</p></section>
  </body>
</FictionBook>`);

function createEpub(): Buffer {
  const zip = new AdmZip();

  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
    ),
  );
  zip.addFile(
    "OEBPS/content.opf",
    Buffer.from(`<?xml version="1.0"?>
      <package xmlns:dc="http://purl.org/dc/elements/1.1/">
        <metadata><dc:title>Test EPUB</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language></metadata>
        <manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest>
        <spine><itemref idref="chapter"/></spine>
      </package>`),
  );
  zip.addFile(
    "OEBPS/chapter.xhtml",
    Buffer.from(
      `<html><body><h1>Chapter one</h1><p>This EPUB chapter has enough readable text to be retained by the parser.</p><a href="javascript:alert(1)">unsafe link</a></body></html>`,
    ),
  );

  return zip.toBuffer();
}

test("parses FB2 content after dependency upgrades", () => {
  const book = parseBook(fb2, "fb2");

  assert.equal(book.title, "Test FB2");
  assert.equal(book.author, "Test Author");
  assert.equal(book.chapters.length, 1);
  assert.match(book.chapters[0]?.htmlContent ?? "", /readable chapter/i);
});

test("parses EPUB content and removes unsafe URI schemes", () => {
  const book = parseBook(createEpub(), "epub");

  assert.equal(book.title, "Test EPUB");
  assert.equal(book.chapters.length, 1);
  assert.doesNotMatch(book.chapters[0]?.htmlContent ?? "", /javascript:/i);
});

test("rejects EPUB archives without the required container file", () => {
  const zip = new AdmZip();
  zip.addFile("OEBPS/chapter.xhtml", Buffer.from("content"));

  assert.throws(
    () => validateBookFile(zip.toBuffer(), "epub"),
    /отсутствует META-INF\/container\.xml/i,
  );
});

test("optimizes SVG images to WebP", async () => {
  const image = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>`,
  );
  const optimized = await optimizeImage(image, "cover");

  assert.equal(optimized.mimeType, "image/webp");
  assert.equal(optimized.extension, "webp");
  assert.ok(optimized.buffer.length > 0);
});

test("generates a WebP cover for long public book metadata", async () => {
  const cover = await createPublicBookCover({
    title: "Очень длинное название книги, которое должно уместиться на обложке",
    author: "Анна-Мария де ла Крус и Александр Константинович Воронцов",
    coverSeed: "0123456789abcdef0123456789abcdef",
  });
  const metadata = await sharp(cover).metadata();

  assert.equal(metadata.format, "webp");
  assert.equal(metadata.width, 900);
  assert.equal(metadata.height, 1260);
});

test("creates an email without an external SMTP connection", async () => {
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const result = await transport.sendMail({
    from: "readora@example.test",
    to: "reader@example.test",
    subject: "Readora test",
    text: "Dependency upgrade test",
  });

  assert.ok(result.messageId);
});

test("creates Multer middleware for book upload endpoints", () => {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  assert.equal(typeof upload.single("file"), "function");
  assert.equal(
    typeof upload.fields([{ name: "file", maxCount: 1 }]),
    "function",
  );
});
