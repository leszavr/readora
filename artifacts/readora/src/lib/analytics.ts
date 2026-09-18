type DeviceMode = "desktop" | "mobile" | "unknown";
type EntryPoint = "library" | "reader" | "book" | "profile";
type NavigationSource = "toc" | "next_chapter" | "prev_chapter" | "restore";
type EndReason = "hidden" | "unmount" | "inactive";
type UploadFormat = "fb2" | "epub";

type AnalyticsEvent = {
  eventId: string;
  eventName: "app_opened" | "library_viewed" | "book_upload_started" | "reader_session_started" | "reader_session_ended" | "reading_progressed" | "chapter_opened" | "progress_sync_finished";
  occurredAt: string;
  localDate: string;
  sessionId: string;
  clientId: string;
  platform: "web";
  deviceMode: DeviceMode;
  appVersion?: string;
  bookId?: number;
  properties: Record<string, boolean | number | string>;
};

type StoredEvent = AnalyticsEvent & { accountId: number; createdAt: number };

const DB_NAME = "readora-analytics";
const STORE_NAME = "events";
const MAX_QUEUE_SIZE = 500;
const MAX_QUEUE_AGE_MS = 14 * 24 * 60 * 60 * 1000;
let accountId: number | null = null;
let enabled = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let sessionId = "";

function newId(): string {
  return crypto.randomUUID();
}

function getClientId(): string {
  const storageKey = "readora.analytics.client-id";
  const existing = localStorage.getItem(storageKey);
  if (existing) return existing;
  const id = newId();
  localStorage.setItem(storageKey, id);
  return id;
}

function getDeviceMode(): DeviceMode {
  if (typeof window === "undefined") return "unknown";
  return window.matchMedia("(pointer: coarse), (max-width: 767px)").matches ? "mobile" : "desktop";
}

function getLocalDate(now: Date): string {
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "eventId" });
      store.createIndex("accountId", "accountId", { unique: false });
      store.createIndex("createdAt", "createdAt", { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = callback(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function getStoredEvents(currentAccountId: number): Promise<StoredEvent[]> {
  const db = await openDatabase();
  try {
    return await new Promise<StoredEvent[]>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).index("accountId").getAll(currentAccountId);
      request.onsuccess = () => resolve(request.result as StoredEvent[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function removeEvents(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      for (const eventId of eventIds) transaction.objectStore(STORE_NAME).delete(eventId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

async function pruneQueue(currentAccountId: number): Promise<void> {
  const events = await getStoredEvents(currentAccountId);
  const cutoff = Date.now() - MAX_QUEUE_AGE_MS;
  const stale = events.filter((event) => event.createdAt < cutoff);
  const retained = events.filter((event) => event.createdAt >= cutoff).sort((left, right) => left.createdAt - right.createdAt);
  const overflow = retained.slice(0, Math.max(0, retained.length - MAX_QUEUE_SIZE));
  await removeEvents([...stale, ...overflow].map((event) => event.eventId));
}

function queue(eventName: AnalyticsEvent["eventName"], properties: AnalyticsEvent["properties"], bookId?: number): void {
  if (!enabled || accountId === null || typeof window === "undefined") return;
  const now = new Date();
  const event: StoredEvent = {
    accountId,
    eventId: newId(),
    eventName,
    occurredAt: now.toISOString(),
    localDate: getLocalDate(now),
    sessionId,
    clientId: getClientId(),
    platform: "web",
    deviceMode: getDeviceMode(),
    ...(bookId === undefined ? {} : { bookId }),
    properties,
    createdAt: now.getTime(),
  };
  const schedule = typeof requestIdleCallback === "function" ? requestIdleCallback : (callback: IdleRequestCallback) => setTimeout(callback, 0) as unknown as number;
  schedule(() => {
    if (!enabled || accountId !== event.accountId) return;
    void withStore("readwrite", (store) => store.put(event)).then(() => pruneQueue(event.accountId)).catch(() => undefined);
  });
}

async function flush(): Promise<void> {
  if (!enabled || accountId === null || !navigator.onLine) return;
  const currentAccountId = accountId;
  const events = (await getStoredEvents(currentAccountId)).sort((left, right) => left.createdAt - right.createdAt).slice(0, 50);
  if (events.length === 0) return;
  if (!enabled || accountId !== currentAccountId) return;
  const response = await fetch("/api/analytics/events/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    keepalive: true,
    body: JSON.stringify({ events: events.map(({ accountId: _accountId, createdAt: _createdAt, ...event }) => event) }),
  });
  if (response.status === 204) {
    await removeEvents(events.map((event) => event.eventId));
    return;
  }
  if (!response.ok) return;
  const result = await response.json() as { acceptedEventIds: string[]; rejectedEventIds: string[] };
  await removeEvents([...result.acceptedEventIds, ...result.rejectedEventIds]);
}

export async function clearAnalyticsQueue(currentAccountId?: number): Promise<void> {
  if (typeof window === "undefined") return;
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      if (currentAccountId === undefined) {
        store.clear();
      } else {
        const request = store.index("accountId").openCursor(IDBKeyRange.only(currentAccountId));
        request.onsuccess = () => {
          const cursor = request.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
      }
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function configureAnalytics(user: { id: number; analyticsOptIn: boolean } | null): void {
  const previousAccountId = accountId;
  accountId = user?.id ?? null;
  enabled = user?.analyticsOptIn === true;
  if (!enabled && previousAccountId !== null) void clearAnalyticsQueue(previousAccountId);
  if (enabled && !sessionId) sessionId = newId();
  if (flushTimer) clearInterval(flushTimer);
  flushTimer = enabled ? setInterval(() => void flush().catch(() => undefined), 10_000) : null;
}

export function startAnalyticsLifecycle(): () => void {
  const send = () => void flush().catch(() => undefined);
  const handleVisibility = () => {
    if (document.visibilityState === "hidden") send();
  };
  window.addEventListener("online", send);
  window.addEventListener("pagehide", send);
  document.addEventListener("visibilitychange", handleVisibility);
  return () => {
    window.removeEventListener("online", send);
    window.removeEventListener("pagehide", send);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}

export function trackAppOpened(entryPoint: EntryPoint): void {
  queue("app_opened", { entryPoint });
}

export function trackLibraryViewed(viewMode: "grid" | "list" | "shelf", filterCount: number, hasSearch: boolean): void {
  queue("library_viewed", { viewMode, filterCount, hasSearch });
}

export function trackBookUploadStarted(format: UploadFormat, fileSize: number): void {
  const fileSizeBucket = fileSize < 1_000_000 ? "under_1mb" : fileSize < 5_000_000 ? "1_to_5mb" : fileSize < 20_000_000 ? "5_to_20mb" : "20_to_50mb";
  queue("book_upload_started", { format, fileSizeBucket });
}

export function trackReaderSessionStarted(bookId: number, startProgressPct: number): void {
  queue("reader_session_started", { startProgressPct }, bookId);
}

export function trackReaderSessionEnded(bookId: number, startProgressPct: number, endProgressPct: number, maxProgressPct: number, activeReadingMs: number, endReason: EndReason): void {
  queue("reader_session_ended", { startProgressPct, endProgressPct, maxProgressPct, activeReadingMs, endReason }, bookId);
}

export function trackReadingProgressed(bookId: number, chapterIndex: number, progressPct: number, intervalActiveMs: number): void {
  queue("reading_progressed", { chapterIndex, progressPct, intervalActiveMs }, bookId);
}

export function trackChapterOpened(bookId: number, chapterIndex: number, navigationSource: NavigationSource): void {
  queue("chapter_opened", { chapterIndex, navigationSource }, bookId);
}

export function trackProgressSyncFinished(outcome: "success" | "error", durationMs: number): void {
  queue("progress_sync_finished", { outcome, durationMs });
}
