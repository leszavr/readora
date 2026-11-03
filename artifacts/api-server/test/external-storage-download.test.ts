import { test } from "node:test";
import assert from "node:assert/strict";

import { readDownloadBody, ExternalStorageError } from "../src/lib/external-storage/drivers";

const DOWNLOAD_MAX_BYTES = 500 * 1024 * 1024;

test("readDownloadBody возвращает буфер для обычного файла", async () => {
  const res = new Response(new Uint8Array([1, 2, 3]), { headers: { "content-length": "3" } });
  const buffer = await readDownloadBody(res);
  assert.deepEqual([...buffer], [1, 2, 3]);
});

test("readDownloadBody работает без content-length", async () => {
  const res = new Response(new Uint8Array([4, 5]));
  const buffer = await readDownloadBody(res);
  assert.equal(buffer.byteLength, 2);
});

test("readDownloadBody отклоняет файл по content-length до чтения тела", async () => {
  const res = new Response(null, { headers: { "content-length": String(DOWNLOAD_MAX_BYTES + 1) } });
  await assert.rejects(
    () => readDownloadBody(res),
    (e: unknown) => e instanceof ExternalStorageError && e.message.includes("превышает допустимый размер"),
  );
});

test("readDownloadBody отклоняет некорректный content-length и читает тело", async () => {
  // Лгущий/мусорный заголовок не должен валить проверку и не должен
  // подменять фактический размер.
  const res = new Response(new Uint8Array([1]), { headers: { "content-length": "abc" } });
  const buffer = await readDownloadBody(res);
  assert.equal(buffer.byteLength, 1);
});
