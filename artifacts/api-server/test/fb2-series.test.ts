import assert from "node:assert/strict";
import test from "node:test";
import { parseBook } from "../src/lib/parser";

const fb2WithSequence = (sequence: string): string => `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0" xmlns:l="http://www.w3.org/1999/xlink">
  <description>
    <title-info>
      <book-title>Книга цикла</book-title>
      <author><first-name>Иван</first-name><last-name>Автор</last-name></author>
      <lang>ru</lang>
      <sequence name="Экспансия" number="3"/>
    </title-info>
    <publish-info>
      <book-name>Книга цикла</book-name>
      ${sequence}
    </publish-info>
  </description>
  <body>
    <section><title><p>Глава 1</p></title><p>Текст первой главы достаточно длинный для парсера.</p></section>
  </body>
</FictionBook>`;

test("FB2 извлекает серию и номер из sequence", () => {
  const parsed = parseBook(Buffer.from(fb2WithSequence("<sequence name=\"Экспансия\" number=\"3\"/>"), "utf8"), "fb2");
  assert.equal(parsed.seriesName, "Экспансия");
  assert.equal(parsed.seriesNumber, 3);
});

test("FB2 берёт серию из publish-info при отсутствии в title-info", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <book-title>Книга цикла</book-title>
      <author><first-name>Иван</first-name><last-name>Автор</last-name></author>
    </title-info>
    <publish-info>
      <book-name>Книга цикла</book-name>
      <sequence name="Публиш-серия" number="1.5"/>
    </publish-info>
  </description>
  <body>
    <section><title><p>Глава 1</p></title><p>Текст первой главы достаточно длинный для парсера.</p></section>
  </body>
</FictionBook>`;
  const parsed = parseBook(Buffer.from(xml, "utf8"), "fb2");
  assert.equal(parsed.seriesName, "Публиш-серия");
  assert.equal(parsed.seriesNumber, 1.5);
});

test("FB2 без sequence возвращает null", () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      <book-title>Без серии</book-title>
      <author><first-name>Иван</first-name><last-name>Автор</last-name></author>
    </title-info>
  </description>
  <body>
    <section><title><p>Глава 1</p></title><p>Текст первой главы достаточно длинный для парсера.</p></section>
  </body>
</FictionBook>`;
  const parsed = parseBook(Buffer.from(xml, "utf8"), "fb2");
  assert.equal(parsed.seriesName, null);
  assert.equal(parsed.seriesNumber, null);
});
