import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { selectEvictionCandidates } from "./book-cache";
import type { OfflineBook, OfflineCachedBook, OfflineLocalBook } from "./db";

function cachedBook(bookId: number, lastAccessAt: number): OfflineCachedBook {
  return {
    id: `server-${bookId}`,
    kind: "cached",
    bookId,
    title: `Книга ${bookId}`,
    author: null,
    format: "fb2",
    fileSize: 1000,
    cover: null,
    file: new Blob(["x"]),
    progressPercent: 10,
    lastAccessAt,
    cachedAt: lastAccessAt,
  };
}

function localBook(id: string, lastAccessAt: number): OfflineLocalBook {
  return {
    id,
    kind: "local",
    title: "Локальная",
    author: null,
    format: "epub",
    fileName: "book.epub",
    fileSize: 1000,
    cover: null,
    file: new Blob(["x"]),
    uploadState: "pending",
    lastAccessAt,
    createdAt: lastAccessAt,
  };
}

describe("selectEvictionCandidates", () => {
  it("возвращает только закэшированные книги по возрастанию lastAccessAt", () => {
    const books: OfflineBook[] = [
      cachedBook(3, 300),
      cachedBook(1, 100),
      cachedBook(2, 200),
    ];
    assert.deepEqual(selectEvictionCandidates(books, 2), ["server-1", "server-2"]);
  });

  it("не трогает локальные книги при вытеснении", () => {
    const books: OfflineBook[] = [
      localBook("local-a", 50),
      cachedBook(1, 100),
      cachedBook(2, 200),
    ];
    assert.deepEqual(selectEvictionCandidates(books, 5), ["server-1", "server-2"]);
  });

  it("исключает книги из excludeIds (например, только что добавленную)", () => {
    const books: OfflineBook[] = [
      cachedBook(1, 100),
      cachedBook(2, 200),
    ];
    assert.deepEqual(selectEvictionCandidates(books, 2, ["server-1"]), ["server-2"]);
  });

  it("count = 0 или отрицательный — пустой результат", () => {
    const books: OfflineBook[] = [cachedBook(1, 100)];
    assert.deepEqual(selectEvictionCandidates(books, 0), []);
  });
});
