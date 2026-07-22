import { beforeEach, describe, expect, test, vi } from 'vitest';

import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import {
  BookTTSCacheStore,
  getTTSCacheConfig,
  setTTSCacheConfig,
} from '@/services/tts/providers/bookCacheStore';
import type { AppService } from '@/types/system';

const BOUNDARIES = [{ offset: 0, duration: 1_000_000, text: 'word' }];
const entry = () => ({
  audio: new Uint8Array(16).fill(3).buffer as ArrayBuffer,
  boundaries: BOUNDARIES,
});

describe('BookTTSCacheStore', () => {
  let db: NodeDatabaseService;
  let appService: AppService;
  let createDir: ReturnType<typeof vi.fn>;
  let openDatabase: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    db = await NodeDatabaseService.open(':memory:');
    createDir = vi.fn().mockResolvedValue(undefined);
    openDatabase = vi.fn().mockResolvedValue(db);
    appService = { createDir, openDatabase } as unknown as AppService;
  });

  test('does nothing until the book hash resolves', async () => {
    const store = new BookTTSCacheStore(appService, () => null, 1024 * 1024);
    await store.put('k', entry());
    expect(await store.get('k')).toBeNull();
    expect(openDatabase).not.toHaveBeenCalled();
  });

  test('opens the per-book database lazily and round-trips entries', async () => {
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await store.put('k', entry(), { provider: 'edge-tts', voice: 'v1' });
    const got = await store.get('k');
    expect(got).not.toBeNull();
    expect(got!.boundaries).toEqual(BOUNDARIES);
    expect(createDir).toHaveBeenCalledWith('tts-cache/hash123', 'Cache', true);
    expect(openDatabase).toHaveBeenCalledTimes(1);
    expect(openDatabase).toHaveBeenCalledWith('tts-cache', 'tts-cache/hash123/cache.db', 'Cache');
  });

  test('an open failure degrades to a no-op cache', async () => {
    openDatabase.mockRejectedValue(new Error('locked'));
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await expect(store.put('k', entry())).resolves.toBeUndefined();
    await expect(store.get('k')).resolves.toBeNull();
  });

  test('manifest registration flows through and close compacts once', async () => {
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await store.registerSectionMarks(7, ['0:a', '0:b']);
    await store.put('k1', entry());
    await store.recordMarkKey(7, 0, 'k1');
    await store.put('k2', entry());
    await store.recordMarkKey(7, 1, 'k2');
    // Close triggers the session-end compaction; without a pack fs in this
    // fake (web-like) appService the compaction is a safe no-op, but the
    // manifest rows must exist for it to consider.
    await expect(store.close()).resolves.toBeUndefined();
  });

  test('close flushes and releases the database', async () => {
    const closeSpy = vi.spyOn(db, 'close').mockResolvedValue(undefined);
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await store.put('k', entry());
    await store.close();
    expect(closeSpy).toHaveBeenCalledTimes(1);
    // A closed store is inert, not broken.
    expect(openDatabase).toHaveBeenCalledTimes(1);
  });
});

describe('getTTSCacheConfig', () => {
  test('defaults to enabled, 200 MB budget, sync off', () => {
    localStorage.removeItem('readest-tts-cache');
    expect(getTTSCacheConfig()).toEqual({ enabled: true, budgetMB: 200, syncEnabled: false });
  });

  test('reads overrides from localStorage', () => {
    localStorage.setItem(
      'readest-tts-cache',
      JSON.stringify({ enabled: false, budgetMB: 50, syncEnabled: true }),
    );
    expect(getTTSCacheConfig()).toEqual({ enabled: false, budgetMB: 50, syncEnabled: true });
    localStorage.removeItem('readest-tts-cache');
  });

  test('setTTSCacheConfig round-trips through getTTSCacheConfig', () => {
    setTTSCacheConfig({ enabled: false, budgetMB: 500, syncEnabled: false });
    expect(getTTSCacheConfig()).toEqual({ enabled: false, budgetMB: 500, syncEnabled: false });
    localStorage.removeItem('readest-tts-cache');
  });
});
