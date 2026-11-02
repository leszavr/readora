import { test } from "node:test";
import assert from "node:assert/strict";

// Модули sync/content-cache импортируют @workspace/db (таблицы), а db-клиент
// требует DATABASE_URL при загрузке. Пул подключается лениво, поэтому для
// юнит-тестов чистых функций достаточно фиктивного URL.
process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";

const { fileExtension, isEntryUnchanged, externalStorageKey, classifyHashDuplicate } = await import("../src/lib/external-storage/sync");
const { chaptersContentBytes } = await import("../src/lib/external-storage/content-cache");
type ExternalFileEntry = Awaited<typeof import("../src/lib/external-storage/drivers")>["ExternalFileEntry"];

function entry(overrides: Partial<ExternalFileEntry> = {}): ExternalFileEntry {
  return {
    name: "book.epub",
    path: "/Books/book.epub",
    isDir: false,
    size: 1000,
    etag: "etag-1",
    modifiedAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

test("fileExtension extracts lowercase extension", () => {
  assert.equal(fileExtension("Book.EPUB"), ".epub");
  assert.equal(fileExtension("noext"), "");
  assert.equal(fileExtension(".fb2"), ".fb2");
});

test("isEntryUnchanged matches by etag when both present", () => {
  const book = { externalEtag: "etag-1", fileSize: 999, externalModifiedAt: null };
  assert.equal(isEntryUnchanged(book, entry()), true);
  assert.equal(isEntryUnchanged(book, entry({ etag: "etag-2", size: 1000 })), false);
});

test("isEntryUnchanged falls back to size and modifiedAt without etag", () => {
  const modifiedAt = new Date("2026-10-01T00:00:00Z");
  const book = { externalEtag: null, fileSize: 1000, externalModifiedAt: modifiedAt };
  assert.equal(isEntryUnchanged(book, entry({ etag: null })), true);
  assert.equal(isEntryUnchanged(book, entry({ etag: null, size: 2000 })), false);
  assert.equal(isEntryUnchanged(book, entry({ etag: null, modifiedAt: new Date("2026-10-02T00:00:00Z") })), false);
});

test("isEntryUnchanged treats zero-size entries as changed", () => {
  const book = { externalEtag: null, fileSize: 0, externalModifiedAt: null };
  assert.equal(isEntryUnchanged(book, entry({ etag: null, size: 0 })), false);
});

test("externalStorageKey is stable and path-dependent", () => {
  const key = externalStorageKey(7, "/Books/book.epub");
  assert.equal(key, externalStorageKey(7, "/Books/book.epub"));
  assert.notEqual(key, externalStorageKey(8, "/Books/book.epub"));
  assert.notEqual(key, externalStorageKey(7, "/Books/other.epub"));
  assert.ok(key.startsWith("external/7/"));
  assert.ok(!key.includes("Books"));
});

test("chaptersContentBytes sums utf-8 byte lengths", () => {
  assert.equal(chaptersContentBytes(["abc"]), 3);
  assert.equal(chaptersContentBytes(["абв"]), 6);
  assert.equal(chaptersContentBytes(["a", "", "абв"]), 7);
  assert.equal(chaptersContentBytes([]), 0);
});

// ─── Классификация дублей по fileHash ────────────────────────────────────────

const CONN = { id: 7, provider: "yandex_disk" as const };

test("classifyHashDuplicate: локальная книга с файлом — кандидат на переезд", () => {
  assert.equal(
    classifyHashDuplicate({ externalConnectionId: null, externalProvider: null, storageKey: "abc123.fb2" }, CONN),
    "candidate",
  );
  assert.equal(
    classifyHashDuplicate({ externalConnectionId: null, externalProvider: null, storageKey: "abc123.zip" }, CONN),
    "candidate",
  );
});

test("classifyHashDuplicate: книга этого подключения — тихая перепривязка", () => {
  assert.equal(
    classifyHashDuplicate(
      { externalConnectionId: 7, externalProvider: "yandex_disk", storageKey: "external/7/x" },
      CONN,
    ),
    "attach",
  );
});

test("classifyHashDuplicate: осиротевшая книга этого провайдера — тихая привязка", () => {
  assert.equal(
    classifyHashDuplicate(
      { externalConnectionId: null, externalProvider: "yandex_disk", storageKey: "external/1/x" },
      CONN,
    ),
    "attach",
  );
});

test("classifyHashDuplicate: привязана к другому хранилищу или осиротела от него — дубликат", () => {
  assert.equal(
    classifyHashDuplicate(
      { externalConnectionId: 8, externalProvider: "mail_ru_cloud", storageKey: "external/8/x" },
      CONN,
    ),
    "duplicate",
  );
  assert.equal(
    classifyHashDuplicate(
      { externalConnectionId: null, externalProvider: "mail_ru_cloud", storageKey: "external/8/x" },
      CONN,
    ),
    "duplicate",
  );
  // книга с внешним storageKey, но без провайдера — не локальная, не кандидат
  assert.equal(
    classifyHashDuplicate({ externalConnectionId: null, externalProvider: null, storageKey: "external/1/x" }, CONN),
    "duplicate",
  );
});

const { isValidSyncJobAction, syncJobStatusAfterAction } = await import("../src/lib/external-storage/sync");

test("isValidSyncJobAction recognizes control actions", () => {
  assert.equal(isValidSyncJobAction("pause"), true);
  assert.equal(isValidSyncJobAction("resume"), true);
  assert.equal(isValidSyncJobAction("cancel"), true);
  assert.equal(isValidSyncJobAction("stop"), false);
  assert.equal(isValidSyncJobAction(1), false);
});

test("syncJobStatusAfterAction allows valid transitions only", () => {
  assert.equal(syncJobStatusAfterAction("processing", "pause"), "paused");
  assert.equal(syncJobStatusAfterAction("queued", "pause"), "paused");
  assert.equal(syncJobStatusAfterAction("paused", "pause"), null);
  assert.equal(syncJobStatusAfterAction("completed", "pause"), null);

  assert.equal(syncJobStatusAfterAction("paused", "resume"), "queued");
  assert.equal(syncJobStatusAfterAction("processing", "resume"), null);

  assert.equal(syncJobStatusAfterAction("paused", "cancel"), "cancelled");
  assert.equal(syncJobStatusAfterAction("processing", "cancel"), "cancelled");
  assert.equal(syncJobStatusAfterAction("completed", "cancel"), null);
  assert.equal(syncJobStatusAfterAction("failed", "cancel"), null);
});
