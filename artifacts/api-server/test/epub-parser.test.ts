import assert from "node:assert/strict";
import test from "node:test";
import AdmZip from "adm-zip";
import { parseEPUB } from "../src/lib/parser";

function buildEpub(files: Record<string, string | Buffer>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) {
    zip.addFile(name, typeof content === "string" ? Buffer.from(content, "utf8") : content);
  }
  return zip.toBuffer();
}

const containerXml = (opfPath: string): string => `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

const longText = (word: string): string => `<p>${`${word} `.repeat(12).trim()}</p>`;

test("EPUB с OPF в пространстве имён opf: разбирает spine и заголовки NCX", () => {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<opf:package version="2.0" unique-identifier="BookId" xmlns:opf="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <opf:metadata>
    <dc:title>Тестовая книга</dc:title>
    <dc:creator>Иван Автор</dc:creator>
    <dc:language>ru</dc:language>
  </opf:metadata>
  <opf:manifest>
    <opf:item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <opf:item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>
    <opf:item id="c2" href="c2.xhtml" media-type="application/xhtml+xml"/>
  </opf:manifest>
  <opf:spine toc="ncx">
    <opf:itemref idref="c1"/>
    <opf:itemref idref="c2"/>
  </opf:spine>
</opf:package>`;

  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1"><navLabel><text>Глава первая</text></navLabel><content src="c1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>Глава вторая</text></navLabel><content src="c2.xhtml"/></navPoint>
  </navMap>
</ncx>`;

  const chapter = (title: string, word: string): string => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1>${longText(word)}</body></html>`;

  const parsed = parseEPUB(
    buildEpub({
      "META-INF/container.xml": containerXml("OEBPS/content.opf"),
      "OEBPS/content.opf": opf,
      "OEBPS/toc.ncx": ncx,
      "OEBPS/c1.xhtml": chapter("Глава первая", "первая"),
      "OEBPS/c2.xhtml": chapter("Глава вторая", "вторая"),
    }),
  );

  assert.equal(parsed.title, "Тестовая книга");
  assert.equal(parsed.author, "Иван Автор");
  assert.deepEqual(parsed.chapters.map((chapter) => chapter.title), ["Глава первая", "Глава вторая"]);
  assert.ok(parsed.chapters.every((chapter) => chapter.wordCount > 0));
});

test("EPUB с одной XHTML-книгой делит её на главы по якорям TOC", () => {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata><dc:title>Книга одним файлом</dc:title><dc:language>ru</dc:language></metadata>
  <manifest>
    <item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="main" href="Untitled.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="main"/></spine>
</package>`;

  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
  <li><a href="Untitled.xhtml">Книга одним файлом</a></li>
  <li><a href="Untitled.xhtml#h1">ПРОЛОГ</a></li>
  <li><a href="Untitled.xhtml#h2">Глава 1: Начало</a></li>
  <li><a href="Untitled.xhtml#h3">Глава 2: Финал</a></li>
</ol></nav></body></html>`;

  const main = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
<p>Титульная страница книги без заголовка.</p>
<h1 id="h1">ПРОЛОГ</h1>${longText("пролог")}
<h1 id="h2">Глава 1: Начало</h1>${longText("начало")}
<h1 id="h3">Глава 2: Финал</h1>${longText("финал")}
</body></html>`;

  const parsed = parseEPUB(
    buildEpub({
      "META-INF/container.xml": containerXml("content.opf"),
      "content.opf": opf,
      "nav.xhtml": nav,
      "Untitled.xhtml": main,
    }),
  );

  assert.deepEqual(
    parsed.chapters.map((chapter) => chapter.title),
    ["ПРОЛОГ", "Глава 1: Начало", "Глава 2: Финал"],
  );
  // Титульная страница присоединена к первой главе, а не стала дублем.
  assert.match(parsed.chapters[0].htmlContent, /Титульная страница/);
});

test("EPUB сохраняет короткую последнюю главу при разбиении по TOC", () => {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata><dc:title>Короткий финал</dc:title></metadata>
  <manifest>
    <item id="toc" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="main" href="book.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="main"/></spine>
</package>`;
  const nav = `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol>
  <li><a href="book.xhtml#start">Начало</a></li>
  <li><a href="book.xhtml#end">Финал</a></li>
</ol></nav></body></html>`;
  const chapter = `<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1 id="start">Начало</h1>${longText("история")}
<h1 id="end">Финал</h1><p>Конец.</p>
</body></html>`;

  const parsed = parseEPUB(
    buildEpub({
      "META-INF/container.xml": containerXml("content.opf"),
      "content.opf": opf,
      "nav.xhtml": nav,
      "book.xhtml": chapter,
    }),
  );

  assert.deepEqual(parsed.chapters.map((item) => item.title), ["Начало", "Финал"]);
  assert.match(parsed.chapters[1].htmlContent, /Конец\./);
});

test("EPUB не отбрасывает отдельную короткую последнюю главу из spine", () => {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata><dc:title>Короткая глава</dc:title></metadata>
  <manifest>
    <item id="start" href="start.xhtml" media-type="application/xhtml+xml"/>
    <item id="end" href="end.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="start"/><itemref idref="end"/></spine>
</package>`;

  const parsed = parseEPUB(
    buildEpub({
      "META-INF/container.xml": containerXml("content.opf"),
      "content.opf": opf,
      "start.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Начало</h1>${longText("история")}</body></html>`,
      "end.xhtml": `<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Конец.</p></body></html>`,
    }),
  );

  assert.equal(parsed.chapters.length, 2);
  assert.match(parsed.chapters[1].htmlContent, /Конец\./);
});

test("EPUB встраивает относительные изображения как data URI", () => {
  const pngBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata><dc:title>Книга с картинкой</dc:title></metadata>
  <manifest>
    <item id="c1" href="text/c1.xhtml" media-type="application/xhtml+xml"/>
    <item id="pic" href="text/images/pic.png" media-type="image/png"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;

  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>Иллюстрация</h1><img src="images/pic.png" alt="Рисунок"/>${longText("текст")}
</body></html>`;

  const parsed = parseEPUB(
    buildEpub({
      "META-INF/container.xml": containerXml("OEBPS/content.opf"),
      "OEBPS/content.opf": opf,
      "OEBPS/text/c1.xhtml": chapter,
      "OEBPS/text/images/pic.png": pngBytes,
    }),
  );

  assert.equal(parsed.chapters.length, 1);
  assert.match(parsed.chapters[0].htmlContent, /src="data:image\/png;base64,/);
});

test("EPUB декодирует HTML-сущности вместо показа их кода", () => {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata><dc:title>Книга с сущностями</dc:title></metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;

  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>Глава</h1>
<p>&nbsp;Текст в &laquo;кавычках&raquo; &mdash; и амперсанд &amp; здесь.</p>${longText("слово")}
</body></html>`;

  const parsed = parseEPUB(
    buildEpub({
      "META-INF/container.xml": containerXml("content.opf"),
      "content.opf": opf,
      "c1.xhtml": chapter,
    }),
  );

  const html = parsed.chapters[0].htmlContent;
  assert.doesNotMatch(html, /&amp;(?:nbsp|laquo|raquo|mdash);/);
  assert.doesNotMatch(html, /&amp;nbsp;/);
  assert.match(html, /«кавычках»/);
  assert.match(html, /—/);
  assert.match(html, /&amp; здесь/);
});

test("EPUB не оставляет ссылки на внешние изображения", () => {
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package version="3.0" unique-identifier="uid" xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata><dc:title>Книга с внешней картинкой</dc:title></metadata>
  <manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;

  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><body>
<h1>Глава</h1>
<img src="https://cdn.example.com/missing.jpg" alt="Иллюстрация"/>
${longText("текст")}
</body></html>`;

  const parsed = parseEPUB(
    buildEpub({
      "META-INF/container.xml": containerXml("content.opf"),
      "content.opf": opf,
      "c1.xhtml": chapter,
    }),
  );

  assert.equal(parsed.chapters.length, 1);
  assert.doesNotMatch(parsed.chapters[0].htmlContent, /<img\b/);
  assert.doesNotMatch(parsed.chapters[0].htmlContent, /cdn\.example\.com/);
});
