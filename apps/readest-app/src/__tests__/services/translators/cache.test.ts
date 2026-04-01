import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock IndexedDB — the module auto-initialises at import time so we need to
// stub `window.indexedDB` *before* importing the module.
//
// vi.hoisted() runs before ESM imports are resolved, so the stubs are in
// place when the module-level `initCache()` executes.
// ---------------------------------------------------------------------------

vi.hoisted(() => {
  const indexedDBOpenMock = vi.fn(() => {
    const req = {
      onerror: null as ((e: unknown) => void) | null,
      onsuccess: null as ((e: unknown) => void) | null,
      onupgradeneeded: null as ((e: unknown) => void) | null,
      result: null,
    };

    // Trigger onerror asynchronously so the promise resolves to rejection.
    queueMicrotask(() => {
      if (req.onerror) {
        req.onerror(new Event('error'));
      }
    });

    return req;
  });

  // Stub indexedDB before the module import so `!window.indexedDB` is false.
  globalThis.indexedDB = { open: indexedDBOpenMock } as unknown as IDBFactory;

  // Suppress console noise from module-level `initCache()`.
  globalThis.console.error = () => {};
  globalThis.console.warn = () => {};

  return {};
});

// ---------------------------------------------------------------------------
// Import the module under test — *after* stubs are in place.
// ---------------------------------------------------------------------------

import {
  getCacheKey,
  getFromCache,
  storeInCache,
  clearCache,
  getCacheStats,
} from '@/services/translators/cache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Directly seed the memory cache by storing entries (storeInCache writes to
 * the memory cache synchronously, then the IDB part fails silently).
 */
async function seedCache(
  entries: {
    text: string;
    translation: string;
    sourceLang: string;
    targetLang: string;
    provider: string;
  }[],
): Promise<void> {
  for (const e of entries) {
    await storeInCache(e.text, e.translation, e.sourceLang, e.targetLang, e.provider);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('translation cache', () => {
  beforeEach(async () => {
    // Suppress expected IndexedDB error/warn noise from the in-memory fallback path.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Clear any leftover memory cache entries between tests.
    await clearCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // getCacheKey
  // -----------------------------------------------------------------------
  describe('getCacheKey', () => {
    test('returns correct format provider:sourceLang:targetLang:text', () => {
      const key = getCacheKey('hello', 'en', 'fr', 'google');
      expect(key).toBe('google:en:fr:hello');
    });

    test('preserves special characters in text', () => {
      const key = getCacheKey('foo:bar:baz', 'en', 'de', 'deepl');
      expect(key).toBe('deepl:en:de:foo:bar:baz');
    });

    test('handles empty strings', () => {
      const key = getCacheKey('', '', '', '');
      expect(key).toBe(':::');
    });
  });

  // -----------------------------------------------------------------------
  // storeInCache + getFromCache (memory cache path)
  // -----------------------------------------------------------------------
  describe('storeInCache / getFromCache (memory path)', () => {
    test('stores and retrieves a translation from memory cache', async () => {
      await storeInCache('hello', 'bonjour', 'en', 'fr', 'google');

      const result = await getFromCache('hello', 'en', 'fr', 'google');
      expect(result).toBe('bonjour');
    });

    test('returns null for cache miss', async () => {
      const result = await getFromCache('missing', 'en', 'fr', 'google');
      expect(result).toBeNull();
    });

    test('returns null for empty text', async () => {
      const result = await getFromCache('', 'en', 'fr', 'google');
      expect(result).toBeNull();
    });

    test('returns null for whitespace-only text', async () => {
      const result = await getFromCache('   ', 'en', 'fr', 'google');
      expect(result).toBeNull();
    });

    test('does not store empty text', async () => {
      await storeInCache('', 'bonjour', 'en', 'fr', 'google');
      const stats = await getCacheStats(false);
      expect(stats.memoryCacheEntries).toBe(0);
    });

    test('does not store empty translation', async () => {
      await storeInCache('hello', '', 'en', 'fr', 'google');
      const stats = await getCacheStats(false);
      expect(stats.memoryCacheEntries).toBe(0);
    });

    test('different providers produce different cache entries', async () => {
      await storeInCache('hello', 'bonjour-google', 'en', 'fr', 'google');
      await storeInCache('hello', 'bonjour-deepl', 'en', 'fr', 'deepl');

      const fromGoogle = await getFromCache('hello', 'en', 'fr', 'google');
      const fromDeepl = await getFromCache('hello', 'en', 'fr', 'deepl');

      expect(fromGoogle).toBe('bonjour-google');
      expect(fromDeepl).toBe('bonjour-deepl');
    });

    test('different language pairs produce different cache entries', async () => {
      await storeInCache('hello', 'bonjour', 'en', 'fr', 'google');
      await storeInCache('hello', 'hallo', 'en', 'de', 'google');

      const fr = await getFromCache('hello', 'en', 'fr', 'google');
      const de = await getFromCache('hello', 'en', 'de', 'google');

      expect(fr).toBe('bonjour');
      expect(de).toBe('hallo');
    });

    test('overwrites existing entry for same key', async () => {
      await storeInCache('hello', 'bonjour', 'en', 'fr', 'google');
      await storeInCache('hello', 'salut', 'en', 'fr', 'google');

      const result = await getFromCache('hello', 'en', 'fr', 'google');
      expect(result).toBe('salut');
    });
  });

  // -----------------------------------------------------------------------
  // clearCache
  // -----------------------------------------------------------------------
  describe('clearCache', () => {
    test('no filter clears all entries', async () => {
      await seedCache([
        { text: 'a', translation: '1', sourceLang: 'en', targetLang: 'fr', provider: 'google' },
        { text: 'b', translation: '2', sourceLang: 'en', targetLang: 'de', provider: 'deepl' },
      ]);

      const deleted = await clearCache();
      expect(deleted).toBe(2);

      const stats = await getCacheStats(false);
      expect(stats.memoryCacheEntries).toBe(0);
    });

    test('provider filter clears only matching provider', async () => {
      await seedCache([
        { text: 'a', translation: '1', sourceLang: 'en', targetLang: 'fr', provider: 'google' },
        { text: 'b', translation: '2', sourceLang: 'en', targetLang: 'fr', provider: 'deepl' },
        { text: 'c', translation: '3', sourceLang: 'en', targetLang: 'de', provider: 'google' },
      ]);

      const deleted = await clearCache({ provider: 'google' });
      expect(deleted).toBe(2);

      // The deepl entry should remain
      const result = await getFromCache('b', 'en', 'fr', 'deepl');
      expect(result).toBe('2');

      // Google entries should be gone
      const resultA = await getFromCache('a', 'en', 'fr', 'google');
      expect(resultA).toBeNull();
    });

    test('maxAge filter clears only old entries', async () => {
      // Seed two entries
      await storeInCache('old', 'alt', 'en', 'de', 'google');

      // Manually backdate the timestamp by manipulating Date.now for the
      // "old" entry. We re-seed with a past timestamp by mocking Date.now
      // temporarily.
      const realNow = Date.now();
      const pastTime = realNow - 100_000; // 100 seconds ago

      // Clear and re-seed with controlled timestamps
      await clearCache();

      // Seed "old" entry with past timestamp
      const origDateNow = Date.now;
      Date.now = () => pastTime;
      await storeInCache('old', 'alt', 'en', 'de', 'google');
      Date.now = origDateNow;

      // Seed "new" entry with current timestamp
      await storeInCache('new', 'neu', 'en', 'de', 'google');

      // Clear entries older than 50 seconds
      const deleted = await clearCache({ maxAge: 50_000 });
      expect(deleted).toBe(1);

      // Old entry should be gone
      const oldResult = await getFromCache('old', 'en', 'de', 'google');
      expect(oldResult).toBeNull();

      // New entry should remain
      const newResult = await getFromCache('new', 'en', 'de', 'google');
      expect(newResult).toBe('neu');
    });

    test('combined provider + maxAge filter', async () => {
      const realNow = Date.now();
      const pastTime = realNow - 200_000;

      // Old google entry
      const origDateNow = Date.now;
      Date.now = () => pastTime;
      await storeInCache('old-g', 'x', 'en', 'fr', 'google');
      await storeInCache('old-d', 'y', 'en', 'fr', 'deepl');
      Date.now = origDateNow;

      // New google entry
      await storeInCache('new-g', 'z', 'en', 'fr', 'google');

      // Only clear old google entries
      const deleted = await clearCache({ provider: 'google', maxAge: 100_000 });
      expect(deleted).toBe(1); // only old-g

      const resultOldG = await getFromCache('old-g', 'en', 'fr', 'google');
      expect(resultOldG).toBeNull();

      // new-g should remain (too new)
      const resultNewG = await getFromCache('new-g', 'en', 'fr', 'google');
      expect(resultNewG).toBe('z');

      // old-d should remain (different provider)
      const resultOldD = await getFromCache('old-d', 'en', 'fr', 'deepl');
      expect(resultOldD).toBe('y');
    });
  });

  // -----------------------------------------------------------------------
  // getCacheStats (memory only)
  // -----------------------------------------------------------------------
  describe('getCacheStats', () => {
    test('returns zero entries when cache is empty', async () => {
      const stats = await getCacheStats(false);
      expect(stats.memoryCacheEntries).toBe(0);
      expect(stats.memoryCacheSizeInBytes).toBe(0);
    });

    test('returns correct entry count', async () => {
      await seedCache([
        { text: 'a', translation: '1', sourceLang: 'en', targetLang: 'fr', provider: 'google' },
        { text: 'b', translation: '2', sourceLang: 'en', targetLang: 'de', provider: 'deepl' },
      ]);

      const stats = await getCacheStats(false);
      expect(stats.memoryCacheEntries).toBe(2);
      expect(stats.memoryCacheSizeInBytes).toBeGreaterThan(0);
    });

    test('size accounts for key and value lengths', async () => {
      await storeInCache('hi', 'salut', 'en', 'fr', 'p');
      const stats = await getCacheStats(false);

      const expectedKey = 'p:en:fr:hi';
      const expectedValue = 'salut';
      expect(stats.memoryCacheSizeInBytes).toBe(expectedKey.length + expectedValue.length);
    });
  });
});
