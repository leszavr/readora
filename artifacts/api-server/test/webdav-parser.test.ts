import { test } from "node:test";
import assert from "node:assert/strict";
import { davEntry, parseDavMultistatus } from "../src/lib/external-storage/drivers";

const PROPFIND_XML = `<?xml version="1.0" encoding="utf-8"?>
<d:multistatus xmlns:d="DAV:">
  <d:response>
    <d:href>/Books/</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Books</d:displayname>
        <d:resourcetype><d:collection/></d:resourcetype>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
  <d:response>
    <d:href>/Books/%D0%9C%D0%B0%D1%81%D1%82%D0%B5%D1%80%20%D0%B8%20%D0%9C%D0%B0%D1%80%D0%B3%D0%B0%D1%80%D0%B8%D1%82%D0%B0.fb2</d:href>
    <d:propstat>
      <d:prop>
        <d:displayname>Мастер и Маргарита.fb2</d:displayname>
        <d:resourcetype/>
        <d:getcontentlength>1048576</d:getcontentlength>
        <d:getlastmodified>Sat, 31 Oct 2026 12:00:00 GMT</d:getlastmodified>
        <d:getetag>"abc123"</d:getetag>
      </d:prop>
      <d:status>HTTP/1.1 200 OK</d:status>
    </d:propstat>
  </d:response>
</d:multistatus>`;

test("parseDavMultistatus parses all responses", () => {
  const responses = parseDavMultistatus(PROPFIND_XML);
  assert.equal(responses.length, 2);
});

test("davEntry detects folder", () => {
  const [folder] = parseDavMultistatus(PROPFIND_XML);
  const entry = davEntry(folder);
  assert.ok(entry);
  assert.equal(entry.isDir, true);
  assert.equal(entry.name, "Books");
  assert.equal(entry.path, "/Books");
});

test("davEntry decodes percent-encoded file href and reads props", () => {
  const [, file] = parseDavMultistatus(PROPFIND_XML);
  const entry = davEntry(file);
  assert.ok(entry);
  assert.equal(entry.isDir, false);
  assert.equal(entry.name, "Мастер и Маргарита.fb2");
  assert.equal(entry.path, "/Books/Мастер и Маргарита.fb2");
  assert.equal(entry.size, 1048576);
  assert.equal(entry.etag, "abc123");
  assert.equal(entry.modifiedAt?.toISOString(), "2026-10-31T12:00:00.000Z");
});

test("davEntry returns null for response without prop", () => {
  assert.equal(davEntry({ href: "/x" }), null);
  assert.equal(davEntry({ propstat: { prop: {} } }), null);
});

test("parseDavMultistatus handles single response and empty body", () => {
  const single = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/a/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`;
  assert.equal(parseDavMultistatus(single).length, 1);
  assert.deepEqual(parseDavMultistatus("<html/>"), []);
});
