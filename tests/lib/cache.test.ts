/**
 * Cache tests for PolliStretch.
 *
 * Tests both createMemoryCache (primary for unit tests) and the interface contract.
 * IndexedDB is not available in jsdom; the IdbCache is tested via e2e in the extension.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMemoryCache, type StretchCache } from "../../src/lib/cache";
import type { StretchChunk, CacheEntry } from "../../src/types";

const SAMPLE_CHUNK: StretchChunk = {
  id: "chunk-1",
  paragraphs: [
    {
      id: "p0",
      kernel: "Essential meaning.",
      context: "Supporting detail and reasoning.",
      full: "Original full text of the paragraph.",
      html: "<p>Original full text of the paragraph.</p>",
      charCount: 33,
    },
  ],
  generatedAt: Date.now(),
  model: "openai/gpt-5.4-nano",
};

const SAMPLE_ENTRY: CacheEntry = {
  key: "test-key-123",
  chunk: SAMPLE_CHUNK,
  expiresAt: Date.now() + 3600_000,
};

function runCacheTests(createCache: (opts?: { now?: () => number }) => StretchCache) {
  let cache: StretchCache;
  let now: number;

  beforeEach(() => {
    now = 1_000_000_000_000;
    cache = createCache({ now: () => now });
  });

  afterEach(async () => {
    await cache.clear();
  });

  describe("get/set", () => {
    it("returns null for missing key", async () => {
      const result = await cache.get("missing");
      expect(result).toBeNull();
    });

    it("stores and retrieves an entry", async () => {
      await cache.set(SAMPLE_ENTRY);
      const result = await cache.get("test-key-123");
      expect(result).not.toBeNull();
      expect(result?.key).toBe("test-key-123");
      expect(result?.chunk.id).toBe("chunk-1");
    });

    it("does not allow caller mutation of set() entry to affect stored copy", async () => {
      const entry1: CacheEntry = {
        key: "test-key-123",
        chunk: {
          ...SAMPLE_CHUNK,
          paragraphs: [{ ...SAMPLE_CHUNK.paragraphs[0] }],
        },
        expiresAt: SAMPLE_ENTRY.expiresAt,
      };
      await cache.set(entry1);
      // Now mutate the original entry after set
      entry1.chunk.paragraphs[0].kernel = "MUTATED";
      const result = await cache.get("test-key-123");
      expect(result?.chunk.paragraphs[0].kernel).toBe("Essential meaning.");
    });
  });

  describe("expiration", () => {
    it("treats expired entries as misses and prunes them", async () => {
      const expiredEntry: CacheEntry = {
        ...SAMPLE_ENTRY,
        expiresAt: now - 1000, // expired
      };
      await cache.set(expiredEntry);
      const result = await cache.get("test-key-123");
      expect(result).toBeNull();
      // Second get should also be null (pruned)
      const again = await cache.get("test-key-123");
      expect(again).toBeNull();
    });

    it("returns live entries before expiry", async () => {
      await cache.set(SAMPLE_ENTRY);
      const result = await cache.get("test-key-123");
      expect(result).not.toBeNull();
    });

    it("returns null exactly at expiry boundary", async () => {
      const boundaryEntry: CacheEntry = {
        ...SAMPLE_ENTRY,
        expiresAt: now,
      };
      await cache.set(boundaryEntry);
      const result = await cache.get("test-key-123");
      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("removes an existing entry", async () => {
      await cache.set(SAMPLE_ENTRY);
      await cache.delete("test-key-123");
      const result = await cache.get("test-key-123");
      expect(result).toBeNull();
    });

    it("is idempotent on missing key", async () => {
      await cache.delete("missing");
      await cache.delete("missing");
      const result = await cache.get("missing");
      expect(result).toBeNull();
    });
  });

  describe("clear", () => {
    it("removes all entries", async () => {
      await cache.set({ ...SAMPLE_ENTRY, key: "a" });
      await cache.set({ ...SAMPLE_ENTRY, key: "b" });
      await cache.clear();
      expect(await cache.get("a")).toBeNull();
      expect(await cache.get("b")).toBeNull();
    });
  });
}

describe("createMemoryCache", () => {
  runCacheTests(createMemoryCache);
});

describe("StretchCache interface contract", () => {
  it("createMemoryCache satisfies StretchCache", () => {
    const cache = createMemoryCache();
    expect(typeof cache.get).toBe("function");
    expect(typeof cache.set).toBe("function");
    expect(typeof cache.delete).toBe("function");
    expect(typeof cache.clear).toBe("function");
  });
});