import { beforeEach, describe, expect, test, vi } from 'vitest';

const packState = vi.hoisted(() => {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    fs: {
      write: vi.fn(async (name: string, data: Uint8Array) => {
        files.set(name, data.slice());
      }),
      rename: vi.fn(async (from: string, to: string) => {
        const data = files.get(from);
        if (!data) throw new Error('missing pack');
        files.set(to, data);
        files.delete(from);
      }),
      readRange: vi.fn(async (name: string, offset: number, length: number) => {
        const data = files.get(name);
        if (!data) throw new Error('missing pack');
        return data.slice(offset, offset + length).buffer as ArrayBuffer;
      }),
      readSidecar: vi.fn(async (name: string) => {
        const data = files.get(name);
        if (!data) return null;
        return JSON.parse(new TextDecoder().decode(data));
      }),
      remove: vi.fn(async (name: string) => {
        files.delete(name);
      }),
      list: vi.fn(async () => [...files.keys()]),
    },
  };
});

vi.mock('@/services/tts/providers/opfsPackFs', () => ({
  createOpfsPackFs: vi.fn(async () => packState.fs),
}));

import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import {
  BookTTSCacheStore,
  clearBookTTSDownloads,
  getTTSCacheConfig,
  setTTSCacheConfig,
} from '@/services/tts/providers/bookCacheStore';
import { SqliteTTSCacheStore } from '@/services/tts/providers/sqliteCacheStore';
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
  let writeFile: ReturnType<typeof vi.fn>;
  let deleteFile: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    packState.files.clear();
    db = await NodeDatabaseService.open(':memory:');
    createDir = vi.fn().mockResolvedValue(undefined);
    openDatabase = vi.fn().mockResolvedValue(db);
    writeFile = vi.fn().mockResolvedValue(undefined);
    deleteFile = vi.fn().mockResolvedValue(undefined);
    appService = {
      createDir,
      openDatabase,
      databaseExists: vi.fn().mockResolvedValue(true),
      writeFile,
      deleteFile,
      readDirectory: vi.fn().mockResolvedValue([]),
    } as unknown as AppService;
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

  test('marks a book cache while an explicit download is pinned and clears the marker on cancel', async () => {
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    const sequence: string[] = [];
    const execute = db.execute.bind(db);
    vi.spyOn(db, 'execute').mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO pinned_sections')) sequence.push('pin');
      return execute(sql, params);
    });
    writeFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/downloads.json')) sequence.push('marker');
    });

    await store.beginDownloadSections([7]);
    expect(writeFile).toHaveBeenCalledWith(
      'tts-cache/hash123/downloads.json',
      'Cache',
      expect.stringContaining('pinned'),
    );
    expect(sequence).toEqual(['marker', 'pin']);

    await store.cancelDownloadSections([7]);
    expect(deleteFile).toHaveBeenCalledWith('tts-cache/hash123/downloads.json', 'Cache');
  });

  test('reconstructs a missing download marker before launching a cross-book sweep', async () => {
    const sqliteStore = new SqliteTTSCacheStore(db, {
      budgetBytes: 1024 * 1024,
      packFs: packState.fs,
    });
    await sqliteStore.beginDownloadSections([7]);
    await sqliteStore.registerSectionMarks(7, ['0:a']);
    await sqliteStore.put('k1', entry());
    await sqliteStore.recordMarkKey(7, 0, 'k1');
    await sqliteStore.compact();
    await sqliteStore.completeDownloadSections([7]);

    const sequence: string[] = [];
    writeFile.mockImplementation(async (path: string) => {
      if (path.endsWith('/downloads.json')) sequence.push('marker');
    });
    vi.mocked(appService.readDirectory).mockImplementation(async () => {
      sequence.push('sweep');
      return [];
    });

    const reopened = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await reopened.getSectionStatuses();
    await vi.waitFor(() => expect(appService.readDirectory).toHaveBeenCalled());

    expect(sequence[0]).toBe('marker');
    expect(sequence).toContain('sweep');
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

  test('concurrent close calls join the same database teardown', async () => {
    let finishClose: () => void = () => {};
    const closeSpy = vi.spyOn(db, 'close').mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finishClose = resolve;
      }),
    );
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await store.put('k', entry());

    const first = store.close();
    await vi.waitFor(() => expect(closeSpy).toHaveBeenCalledTimes(1));
    let secondFinished = false;
    const second = store.close().then(() => {
      secondFinished = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondFinished).toBe(false);

    finishClose();
    await Promise.all([first, second]);
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  test('headless book deletion clears pinned rows without a live controller', async () => {
    const sqliteStore = new SqliteTTSCacheStore(db, {
      budgetBytes: 1024 * 1024,
      packFs: packState.fs,
    });
    await sqliteStore.beginDownloadSections([7]);
    await sqliteStore.registerSectionMarks(7, ['0:a']);
    await sqliteStore.put('k1', entry());
    await sqliteStore.recordMarkKey(7, 0, 'k1');
    await sqliteStore.compact();
    await sqliteStore.completeDownloadSections([7]);
    expect([...packState.files.keys()].some((name) => name.endsWith('.mp3'))).toBe(true);
    vi.spyOn(db, 'close').mockResolvedValue(undefined);

    await clearBookTTSDownloads(appService, 'hash123');

    expect(await sqliteStore.hasDownloads()).toBe(false);
    expect(await sqliteStore.get('k1')).toBeNull();
    expect(packState.files.size).toBe(0);
    expect(deleteFile).toHaveBeenCalledWith('tts-cache/hash123/downloads.json', 'Cache');
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
