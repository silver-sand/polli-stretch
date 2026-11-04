/**
 * Result caching for generated stretch chunks.
 *
 * Two implementations share one interface:
 *  - `createIdbCache()`   — persistent, backed by IndexedDB. IndexedDB is
 *    available in MV3 service workers (which have no DOM), so this is what
 *    production uses.
 *  - `createMemoryCache()` — in-memory, for tests and as a degradation path.
 *
 * Expired entries (`expiresAt <= now`) are treated as misses by `get`.
 */

import type { CacheEntry } from "../types";

export interface StretchCache {
  get(key: string): Promise<CacheEntry | null>;
  set(entry: CacheEntry): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

const DEFAULT_DB_NAME = "polli-stretch";
const STORE_NAME = "chunks";
const DB_VERSION = 1;

/** True for entries that are still valid at `now`. */
function isLive(entry: CacheEntry | undefined, now: number): entry is CacheEntry {
  return !!entry && entry.expiresAt > now;
}

/** Turn a DOMException-ish failure into a message a reader can act on. */
function describeIdbError(err: unknown): Error {
  const e = err as { name?: string; message?: string } | null;
  if (e?.name === "QuotaExceededError") {
    return new Error(
      "PolliStretch cache is full. Clear the cache in Settings and try again.",
    );
  }
  if (e?.name === "InvalidStateError") {
    return new Error("PolliStretch cache is unavailable in this browser context.");
  }
  return new Error(
    `PolliStretch cache error: ${e?.message ?? String(err ?? "unknown error")}`,
  );
}

function promisifyRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function waitForTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export interface IdbCacheOptions {
  /** Override the database name (tests). */
  dbName?: string;
  /** Override the IDBFactory (tests, or non-window contexts). */
  factory?: IDBFactory;
  /** Clock injection (tests). */
  now?: () => number;
}

export function createIdbCache(options: IdbCacheOptions = {}): StretchCache {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const now = options.now ?? (() => Date.now());
  const factory = options.factory ?? globalThis.indexedDB;

  if (!factory) {
    throw new Error("IndexedDB is not available in this context.");
  }

  let dbPromise: Promise<IDBDatabase> | null = null;

  function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(dbName, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB"));
      req.onblocked = () =>
        reject(new Error("PolliStretch cache is blocked by another tab."));
    });
    // A failed open should not poison the cache forever.
    dbPromise.catch(() => {
      dbPromise = null;
    });
    return dbPromise;
  }

  /** Run one operation against the cache store with consistent error mapping. */
  async function withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    try {
      const db = await openDb();
      const tx = db.transaction(STORE_NAME, mode);
      const req = fn(tx.objectStore(STORE_NAME));
      const result = await promisifyRequest(req);
      if (mode !== "readonly") await waitForTransaction(tx);
      return result;
    } catch (err) {
      throw describeIdbError(err);
    }
  }

  return {
    async get(key) {
      const entry = await withStore<CacheEntry | undefined>(
        "readonly",
        (store) => store.get(key) as IDBRequest<CacheEntry | undefined>,
      );
      return isLive(entry, now()) ? entry : null;
    },

    async set(entry) {
      await withStore("readwrite", (store) => store.put(entry) as IDBRequest<IDBValidKey>);
    },

    async delete(key) {
      await withStore("readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
    },

    async clear() {
      await withStore("readwrite", (store) => store.clear() as IDBRequest<undefined>);
    },
  };
}

export function createMemoryCache(options: { now?: () => number } = {}): StretchCache {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, CacheEntry>();

  return {
    async get(key) {
      const entry = entries.get(key);
      if (!isLive(entry, now())) {
        if (entry) entries.delete(key); // prune expired
        return null;
      }
      return entry;
    },
    async set(entry) {
      // Copy so later mutation by the caller cannot corrupt the cache.
      entries.set(entry.key, { ...entry, chunk: structuredCloneSafe(entry.chunk) });
    },
    async delete(key) {
      entries.delete(key);
    },
    async clear() {
      entries.clear();
    },
  };
}

/** structuredClone when available, otherwise a JSON round-trip. */
function structuredCloneSafe<T>(value: T): T {
  const clone = (globalThis as { structuredClone?: <U>(v: U) => U }).structuredClone;
  if (typeof clone === "function") return clone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
