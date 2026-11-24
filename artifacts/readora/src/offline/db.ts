// Офлайн-хранилище Readora (IndexedDB, БД readora-offline).
// См. docs/offline/adr-0001-offline-mode.md и AGENTS.md §11.
//
// Модуль низкоуровневый: схема, типы и промис-обёртки над raw IndexedDB
// (прецедент — src/lib/analytics.ts). Доменная логика (кэширование, LRU,
// синхронизация) — в соседних модулях. Только клиентский код, не для SSR.

import { randomId } from "@/lib/random-id";

export const OFFLINE_DB_NAME = "readora-offline";
export const OFFLINE_DB_VERSION = 1;

/** Книга, закэшированная с сервера (книги с прогрессом чтения). */
export type OfflineCachedBook = {
  id: string; // `server-{bookId}`
  kind: "cached";
  bookId: number;
  title: string;
  author: string | null;
  format: string;
  fileSize: number;
  cover: Blob | null;
  file: Blob;
  progressPercent: number;
  lastAccessAt: number;
  cachedAt: number;
};

/** Книга, загруженная локально (ждёт выгрузки на сервер, лимит 10). */
export type OfflineLocalBook = {
  id: string; // `local-{uuid}`
  kind: "local";
  title: string;
  author: string | null;
  format: string;
  fileName: string;
  fileSize: number;
  cover: Blob | null;
  file: Blob;
  uploadState: "pending" | "uploading" | "uploaded";
  lastAccessAt: number;
  createdAt: number;
};

export type OfflineBook = OfflineCachedBook | OfflineLocalBook;

/** Отложенная операция синхронизации (этап 5 плана). */
export type OfflinePendingOp =
  | { id: string; type: "progress"; bookId: number; payload: string; createdAt: number }
  | { id: string; type: "upload"; localBookId: string; createdAt: number };

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const books = db.createObjectStore("books", { keyPath: "id" });
      books.createIndex("kind", "kind", { unique: false });
      books.createIndex("bookId", "bookId", { unique: false });
      books.createIndex("lastAccessAt", "lastAccessAt", { unique: false });
      db.createObjectStore("pending", { keyPath: "id" });
      db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  storeName: "books" | "pending" | "meta",
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  try {
    return await requestToPromise(callback(db.transaction(storeName, mode).objectStore(storeName)));
  } finally {
    db.close();
  }
}

export function cachedBookId(bookId: number): string {
  return `server-${bookId}`;
}

export function newLocalBookId(): string {
  return `local-${randomId()}`;
}

export async function getOfflineBook(id: string): Promise<OfflineBook | undefined> {
  return withStore("books", "readonly", (store) => store.get(id) as IDBRequest<OfflineBook | undefined>);
}

export async function getCachedBook(bookId: number): Promise<OfflineCachedBook | undefined> {
  const book = await getOfflineBook(cachedBookId(bookId));
  return book?.kind === "cached" ? book : undefined;
}

export async function putOfflineBook(book: OfflineBook): Promise<void> {
  await withStore("books", "readwrite", (store) => store.put(book) as unknown as IDBRequest<IDBValidKey>);
}

export async function deleteOfflineBook(id: string): Promise<void> {
  await withStore("books", "readwrite", (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}

export async function listOfflineBooks(): Promise<OfflineBook[]> {
  return withStore("books", "readonly", (store) => store.getAll() as IDBRequest<OfflineBook[]>);
}

export async function listCachedBooks(): Promise<OfflineCachedBook[]> {
  return withStore("books", "readonly", (store) =>
    (store.index("kind").getAll("cached") as IDBRequest<OfflineCachedBook[]>),
  );
}

export async function listLocalBooks(): Promise<OfflineLocalBook[]> {
  return withStore("books", "readonly", (store) =>
    (store.index("kind").getAll("local") as IDBRequest<OfflineLocalBook[]>),
  );
}

export async function putPendingOp(op: OfflinePendingOp): Promise<void> {
  await withStore("pending", "readwrite", (store) => store.put(op) as unknown as IDBRequest<IDBValidKey>);
}

export async function listPendingOps(): Promise<OfflinePendingOp[]> {
  return withStore("pending", "readonly", (store) => store.getAll() as IDBRequest<OfflinePendingOp[]>);
}

export async function deletePendingOp(id: string): Promise<void> {
  await withStore("pending", "readwrite", (store) => store.delete(id) as unknown as IDBRequest<undefined>);
}

/** Полная очистка офлайн-хранилища (logout/смена аккаунта, AGENTS.md §11.4). */
export async function clearOfflineStorage(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}
