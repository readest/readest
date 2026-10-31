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

const bookData = vi.hoisted(() => ({
  destinations: [{ id: 'webdav' }, { id: 'readest' }],
  getBookDataDestinations: vi.fn(async () => [] as { id: string }[]),
  pullBookData: vi.fn(async () => 0),
  pushBookData: vi.fn(async () => 0),
}));

const bookConfig = vi.hoisted(() => ({
  config: null as { ttsPacks?: Record<string, string[]>; updatedAt?: number } | null,
  setConfig: vi.fn((_key: string, update: object) => {
    bookConfig.config = { ...bookConfig.config, ...update };
  }),
  book: { hash: 'hash-rec4' },
  settings: { kind: 'settings' },
}));
vi.mock('@/store/libraryStore', () => ({
  useLibraryStore: { getState: () => ({ getBookByHash: () => bookConfig.book }) },
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: bookConfig.settings }) },
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: {
    getState: () => ({
      getConfig: () => bookConfig.config,
      setConfig: bookConfig.setConfig,
    }),
  },
}));

vi.mock('@/services/sync/bookData/destinationsFor', () => ({
  getBookDataDestinations: bookData.getBookDataDestinations,
}));
vi.mock('@/services/sync/bookData/engine', () => ({
  pullBookData: bookData.pullBookData,
  pushBookData: bookData.pushBookData,
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
      saveBookConfig: vi.fn(async () => {}),
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

  test('forwards the keys a synced pack brought, from before its pull starts', async () => {
    const register = vi.spyOn(SqliteTTSCacheStore.prototype, 'onImported');
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    const imported = vi.fn();
    store.onImported(imported);
    await store.open();
    expect(register).toHaveBeenCalledTimes(1);
    register.mock.calls[0]![0](['k1']);
    expect(imported).toHaveBeenCalledWith(['k1']);
    register.mockRestore();
  });

  test('opening syncs through every book-data destination, pull before push', async () => {
    // A section downloaded while sync was off: no later compaction creates
    // its pack again, so the open is the only chance to upload it.
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

    bookData.getBookDataDestinations.mockResolvedValue(bookData.destinations);
    bookData.pullBookData.mockClear();
    bookData.pushBookData.mockClear();
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await store.open();
    await vi.waitFor(() =>
      expect(bookData.pushBookData).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tts' }),
        'hash123',
        bookData.destinations,
        expect.any(Map),
      ),
    );
    expect(bookData.getBookDataDestinations).toHaveBeenCalledWith(appService, 'hash123');
    expect(bookData.pullBookData).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'tts' }),
      'hash123',
      bookData.destinations,
      expect.any(Map),
    );
    expect(bookData.pullBookData).toHaveBeenCalledBefore(bookData.pushBookData);
  });

  test('opening with no book-data destination moves nothing', async () => {
    bookData.getBookDataDestinations.mockResolvedValue([]);
    bookData.pullBookData.mockClear();
    bookData.pushBookData.mockClear();
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await store.open();
    await vi.waitFor(() => expect(bookData.getBookDataDestinations).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(bookData.pullBookData).not.toHaveBeenCalled();
    expect(bookData.pushBookData).not.toHaveBeenCalled();
  });

  test('finishing a download pushes its pack even when listening already made it', async () => {
    // Section 7 was packed by ordinary listening, so the open's push skipped
    // it and the download creates no new pack.
    const sqliteStore = new SqliteTTSCacheStore(db, {
      budgetBytes: 1024 * 1024,
      packFs: packState.fs,
    });
    await sqliteStore.registerSectionMarks(7, ['0:a']);
    await sqliteStore.put('k1', entry());
    await sqliteStore.recordMarkKey(7, 0, 'k1');
    await sqliteStore.compact();

    bookData.getBookDataDestinations.mockResolvedValue(bookData.destinations);
    const store = new BookTTSCacheStore(appService, () => 'hash777', 1024 * 1024);
    await store.open();
    const pushed = () =>
      expect(bookData.pushBookData).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tts' }),
        'hash777',
        bookData.destinations,
        expect.any(Map),
      );
    await vi.waitFor(pushed);
    bookData.pushBookData.mockClear();
    await store.beginDownloadSections([7]);
    await store.compact();
    await store.completeDownloadSections([7]);
    await vi.waitFor(pushed);
  });

  test("a book's sync rounds run one after another", async () => {
    // Overlapping rounds would both see a pack missing and upload it twice,
    // through the same Cache outbox file.
    bookData.getBookDataDestinations.mockResolvedValue(bookData.destinations);
    let release: () => void = () => {};
    bookData.pushBookData.mockClear();
    bookData.pushBookData.mockImplementationOnce(
      () => new Promise<number>((resolve) => (release = () => resolve(0))),
    );
    const store = new BookTTSCacheStore(appService, () => 'hash555', 1024 * 1024);
    await store.open();
    await vi.waitFor(() => expect(bookData.pushBookData).toHaveBeenCalledTimes(1));
    await store.completeDownloadSections([]);
    await new Promise((r) => setTimeout(r, 20));
    expect(bookData.pushBookData).toHaveBeenCalledTimes(1);
    release();
    await vi.waitFor(() => expect(bookData.pushBookData).toHaveBeenCalledTimes(2));
  });

  test("a book's push rounds reuse the open's destinations and listings", async () => {
    // Each finished section of a download starts a push round; fresh
    // destinations would list and prepare folders again every round.
    bookData.getBookDataDestinations.mockImplementation(async () => [
      { id: 'webdav' },
      { id: 'readest' },
    ]);
    bookData.pullBookData.mockClear();
    bookData.pushBookData.mockClear();
    const store = new BookTTSCacheStore(appService, () => 'hash444', 1024 * 1024);
    await store.open();
    await vi.waitFor(() => expect(bookData.pushBookData).toHaveBeenCalledTimes(1));
    await store.completeDownloadSections([]);
    await vi.waitFor(() => expect(bookData.pushBookData).toHaveBeenCalledTimes(2));

    const [, , pulledTo, pullListings] = bookData.pullBookData.mock.calls[0] as unknown[];
    const [, , pushedTo, pushListings] = bookData.pushBookData.mock.calls[1] as unknown[];
    expect(pullListings).toBeInstanceOf(Map);
    expect(pushListings).toBe(pullListings);
    expect((pushedTo as unknown[])[0]).toBe((pulledTo as unknown[])[0]);
    expect((pushedTo as unknown[])[1]).toBe((pulledTo as unknown[])[1]);
    bookData.getBookDataDestinations.mockReset();
    bookData.getBookDataDestinations.mockResolvedValue([]);
  });

  describe('with the packs recorded in the book config', () => {
    const openWith = async (hash: string, ttsPacks?: Record<string, string[]>) => {
      bookConfig.config = { ttsPacks, updatedAt: 42 };
      bookConfig.setConfig.mockClear();
      bookData.getBookDataDestinations.mockResolvedValue(bookData.destinations);
      bookData.pullBookData.mockClear();
      bookData.pushBookData.mockClear();
      const store = new BookTTSCacheStore(appService, () => hash, 1024 * 1024);
      await store.open();
      await vi.waitFor(() => expect(bookData.pushBookData).toHaveBeenCalled());
    };

    test('an open pulls nothing when every destination is recorded and nothing is missing', async () => {
      // A book without audio, synced before: no listing at all.
      await openWith('hash-rec1', { webdav: [], readest: [] });
      expect(bookData.pullBookData).not.toHaveBeenCalled();
    });

    test('keeps an entry another sync merged while the round ran', async () => {
      // The reader's open-time pull can merge a peer's record while this
      // round awaits its listings; writing back the record read at the start
      // would drop it.
      bookData.pullBookData.mockImplementationOnce(async (...args: unknown[]) => {
        const listings = args[3] as Map<string, Set<string> | null>;
        listings.set('webdav', new Set(['1-a.mp3', '1-a.json']));
        bookConfig.config = { ...bookConfig.config, ttsPacks: { gdrive: ['9-z.mp3'] } };
        return 0;
      });
      await openWith('hash-rec6', undefined);
      await vi.waitFor(() =>
        expect(bookConfig.setConfig).toHaveBeenCalledWith('hash-rec6', {
          ttsPacks: { gdrive: ['9-z.mp3'], webdav: ['1-a.mp3'] },
        }),
      );
    });

    test('keeps a pack merged into a destination while the round listed it', async () => {
      // A peer's pack can land in the record after this round's listing began;
      // replacing the destination with the listing would drop it, and the next
      // open would skip pulling it. Entries the round started with are still
      // replaced by the listing.
      bookData.pullBookData.mockImplementationOnce(async (...args: unknown[]) => {
        const listings = args[3] as Map<string, Set<string> | null>;
        listings.set('webdav', new Set(['1-a.mp3', '1-a.json']));
        bookConfig.config = {
          ...bookConfig.config,
          ttsPacks: { webdav: ['0-gone.mp3', '2-b.mp3'] },
        };
        return 0;
      });
      await openWith('hash-rec7', { webdav: ['0-gone.mp3'] });
      await vi.waitFor(() =>
        expect(bookConfig.setConfig).toHaveBeenCalledWith('hash-rec7', {
          ttsPacks: { webdav: ['1-a.mp3', '2-b.mp3'] },
        }),
      );
    });

    test('the push never trusts the record, so purged packs are uploaded again', async () => {
      // The record only grows by merging: after a book's audio is purged from
      // a destination (the book removed from Readest Cloud) it still names
      // those packs, and a push trusting it would never upload them again.
      await openWith('hash-rec5', { readest: ['1-a.mp3'] });
      expect(bookData.pushBookData).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'tts' }),
        'hash-rec5',
        bookData.destinations,
        expect.any(Map),
      );
      expect(bookData.pushBookData.mock.calls[0]).toHaveLength(4);
    });

    test('an open pulls when the record lists a pack this device lacks', async () => {
      await openWith('hash-rec2', { webdav: ['9-x.mp3'], readest: [] });
      expect(bookData.pullBookData).toHaveBeenCalled();
    });

    test('an open lists a destination the config never recorded', async () => {
      await openWith('hash-rec3', { webdav: [] });
      expect(bookData.pullBookData).toHaveBeenCalled();
    });

    test('records what each listed destination holds, a declining one as empty', async () => {
      bookData.pullBookData.mockImplementationOnce(async (...args: unknown[]) => {
        const listings = args[3] as Map<string, Set<string> | null>;
        listings.set('webdav', new Set(['1-a.mp3', '1-a.json', '2-b.mp3']));
        listings.set('readest', null);
        return 0;
      });
      await openWith('hash-rec4', undefined);
      await vi.waitFor(() =>
        expect(bookConfig.setConfig).toHaveBeenCalledWith('hash-rec4', {
          ttsPacks: { webdav: ['1-a.mp3'], readest: [] },
        }),
      );
      // Saved to the book's config file at once, so a quit before the next
      // page turn keeps it; updatedAt untouched, so progress can't move.
      await vi.waitFor(() =>
        expect(appService.saveBookConfig).toHaveBeenCalledWith(
          bookConfig.book,
          { updatedAt: 42, ttsPacks: { webdav: ['1-a.mp3'], readest: [] } },
          bookConfig.settings,
        ),
      );
    });
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

  test('close waits for an active compaction before closing the database', async () => {
    const store = new BookTTSCacheStore(appService, () => 'hash123', 1024 * 1024);
    await store.registerSectionMarks(7, ['0:a']);
    await store.put('k1', entry());
    await store.recordMarkKey(7, 0, 'k1');
    const writing = Promise.withResolvers<void>();
    const resume = Promise.withResolvers<void>();
    const write = packState.fs.write.getMockImplementation()!;
    packState.fs.write.mockImplementationOnce(async (name, data) => {
      writing.resolve();
      await resume.promise;
      await write(name, data);
    });
    const close = vi.spyOn(db, 'close');
    const compacting = store.compact();
    await writing.promise;
    const closing = store.close();
    // Let the close path run while the first pack write remains suspended.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const closedEarly = close.mock.calls.length > 0;
    resume.resolve();
    const results = await Promise.allSettled([compacting, closing]);

    expect(closedEarly).toBe(false);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(close).toHaveBeenCalledOnce();
    expect([...packState.files.keys()].filter((name) => name.endsWith('.mp3'))).toHaveLength(1);
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
  test('defaults to enabled, 200 MB budget', () => {
    localStorage.removeItem('readest-tts-cache');
    expect(getTTSCacheConfig()).toEqual({ enabled: true, budgetMB: 200 });
  });

  test('reads overrides from localStorage and ignores the old sync switch', () => {
    localStorage.setItem(
      'readest-tts-cache',
      JSON.stringify({ enabled: false, budgetMB: 50, syncEnabled: true }),
    );
    expect(getTTSCacheConfig()).toEqual({ enabled: false, budgetMB: 50 });
    localStorage.removeItem('readest-tts-cache');
  });

  test('setTTSCacheConfig round-trips through getTTSCacheConfig', () => {
    setTTSCacheConfig({ enabled: false, budgetMB: 500 });
    expect(getTTSCacheConfig()).toEqual({ enabled: false, budgetMB: 500 });
    localStorage.removeItem('readest-tts-cache');
  });
});
