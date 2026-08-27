import { describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import { FileSyncError, type FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * #5900: multi-device file sync never converged. Defect 1 — a 'send' run
 * rewriting library.json it never read — is covered by
 * engine-send-only-index-safety.test.ts. This file covers the rest:
 *
 *   - the other records that re-push carries (emptyDirs), and the abort that
 *     protects them when the index cannot be read at all;
 *   - the incremental/Full Sync split: an incremental run of ANY strategy stays
 *     O(changed) and never re-reads the index, while Full Sync is the pass that
 *     re-audits files and reconciles against concurrent writers;
 *   - defect 2, the actual standoff: republishing a live row over a peer's
 *     tombstone carried the row's OLD `updatedAt`, and a peer revives only on
 *     `remote.updatedAt > local.deletedAt`, so a row last edited before the
 *     deletion could never win. The two devices ping-ponged live row vs
 *     tombstone forever (the reporter's "BOOX stays at 129 books");
 *   - defect 3, a failed library.json write swallowed by a console.warn, so a
 *     run that converged nothing still reported success.
 */

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
  sourceTitle: `Book ${hash}`,
  author: 'A',
  createdAt: 1,
  updatedAt: 100,
  ...overrides,
});

type Captured = { writes: { path: string; body: string }[] };

const fakeProvider = (
  opts: Partial<FileSyncProvider> & { captured?: Captured } = {},
): FileSyncProvider => ({
  rootPath: '/',
  readText: opts.readText ?? (async () => null),
  readBinary: opts.readBinary ?? (async () => new ArrayBuffer(8)),
  head: opts.head ?? (async () => null),
  list: opts.list ?? (async () => []),
  writeText:
    opts.writeText ??
    (async (path: string, body: string) => {
      opts.captured?.writes.push({ path, body });
    }),
  writeBinary: opts.writeBinary ?? (async () => {}),
  ensureDir: opts.ensureDir ?? (async () => {}),
  deleteDir: opts.deleteDir ?? (async () => {}),
});

const fakeStore = (opts: Partial<LocalStore> = {}): LocalStore => ({
  loadConfig: opts.loadConfig ?? (async () => ({ updatedAt: 1, booknotes: [] })),
  saveBookConfig: opts.saveBookConfig ?? (async () => {}),
  loadBookFile: opts.loadBookFile ?? (async () => ({ bytes: new ArrayBuffer(16), size: 16 })),
  resolveLocalBookPath: opts.resolveLocalBookPath ?? (async () => ({ path: '/src', size: 16 })),
  saveBookFile: opts.saveBookFile ?? (async () => {}),
  prepareLocalBookPath: opts.prepareLocalBookPath ?? (async () => '/local/dst'),
  loadBookCover: opts.loadBookCover ?? (async () => null),
  saveBookCover: opts.saveBookCover ?? (async () => {}),
  addBookToLibrary: opts.addBookToLibrary ?? (async () => {}),
  updateBookMetadata: opts.updateBookMetadata ?? (async () => {}),
  deleteBookLocally: opts.deleteBookLocally ?? (async () => {}),
  markBooksUploaded: opts.markBooksUploaded ?? (async () => {}),
});

const indexServing = (index: RemoteLibraryIndex) => async (p: string) =>
  p.endsWith('library.json') ? JSON.stringify(index) : null;

const pushedIndex = (captured: Captured): RemoteLibraryIndex | null => {
  const write = captured.writes.find((w) => w.path.endsWith('library.json'));
  return write ? (JSON.parse(write.body) as RemoteLibraryIndex) : null;
};

describe('FileSyncEngine.syncLibrary — Send Only reads the index safely (#5900)', () => {
  test('carries forward the remote emptyDirs record', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1')],
        emptyDirs: ['h9'],
      }),
      captured,
    });

    await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'send', syncBooks: false, deviceId: 'pc' },
    );

    expect(pushedIndex(captured)!.emptyDirs).toEqual(['h9']);
  });

  test('aborts rather than rewriting an index it could not read', async () => {
    // Now that the re-push carries peers' books, tombstones and uploaded-file
    // record forward, writing an index we failed to READ would wipe all three.
    // An unreadable index (throw) is not an absent one (404 -> null).
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) => {
        if (p.endsWith('library.json')) throw new FileSyncError('offline', 'NETWORK', 503);
        return null;
      },
      captured,
    });

    await expect(
      new FileSyncEngine(provider, fakeStore()).syncLibrary([makeBook('h1')], {
        strategy: 'send',
        syncBooks: false,
        deviceId: 'pc',
      }),
    ).rejects.toThrow('offline');
    expect(pushedIndex(captured)).toBeNull();
  });

  test('an incremental send trusts the uploaded-file record and stays O(changed)', async () => {
    // Before #5900 'send' never read the index, so `uploadedHashes` was always
    // empty and every run re-probed every book — an O(library) storm of remote
    // HEADs and local fs stats that a large library cannot afford. Reading the
    // index is what makes Send Only incremental. Drift is Full Sync's job.
    const fileProbes: string[] = [];
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1')],
        uploadedHashes: ['h1'],
      }),
      head: async (p) => {
        if (p.endsWith('.epub')) fileProbes.push(p);
        return null;
      },
    });

    const res = await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { downloadedAt: 1 })],
      { strategy: 'send', syncBooks: true, fullSync: false, deviceId: 'pc' },
    );

    expect(fileProbes).toEqual([]);
    expect(res.filesUploaded).toBe(0);
  });

  test('a Full Sync send re-audits the file even when the record claims it', async () => {
    // The escape hatch the incremental path defers to: Full Sync bypasses the
    // record and verifies the bytes are really there.
    const fileProbes: string[] = [];
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1')],
        uploadedHashes: ['h1'],
      }),
      head: async (p) => {
        if (p.endsWith('.epub')) fileProbes.push(p);
        return null;
      },
    });

    const res = await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { downloadedAt: 1 })],
      { strategy: 'send', syncBooks: true, fullSync: true, deviceId: 'pc' },
    );

    expect(fileProbes.length).toBe(1);
    expect(res.filesUploaded).toBe(1);
  });
});

describe('FileSyncEngine.syncLibrary — tombstone revival converges (#5900)', () => {
  test('a send push over a peer tombstone publishes a row that outranks it', async () => {
    // The reporter's deadlock: the PC keeps the book (last edited at 100), a
    // peer deleted it at 5000. Republishing with updatedAt 100 can never beat
    // the peer's `deletedAt` 5000, so the peer re-pushes its tombstone and the
    // two devices ping-pong forever. The republish IS the newer decision and
    // must be stamped as such.
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 100, deletedAt: 5000 })],
      }),
      captured,
    });

    await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'send', syncBooks: false, deviceId: 'pc' },
    );

    const row = pushedIndex(captured)!.books.find((b) => b.hash === 'h1')!;
    expect(row.deletedAt).toBeFalsy();
    expect(row.updatedAt).toBeGreaterThan(5000);
  });

  test('persists the revival stamp locally so the next run does not regress it', async () => {
    const updateBookMetadata = vi.fn<(b: Book) => Promise<void>>(async () => {});
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 100, deletedAt: 5000 })],
      }),
    });

    await new FileSyncEngine(provider, fakeStore({ updateBookMetadata })).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'send', syncBooks: false, deviceId: 'pc' },
    );

    expect(updateBookMetadata).toHaveBeenCalledTimes(1);
    const saved = updateBookMetadata.mock.calls[0]![0];
    expect(saved.hash).toBe('h1');
    expect(saved.updatedAt).toBeGreaterThan(5000);
    expect(saved.deletedAt).toBeFalsy();
  });

  test('does not stamp a row the remote already has live', async () => {
    // Only a republish OVER a tombstone is a new decision. An ordinary send
    // must leave `updatedAt` alone, or every run rewrites every row.
    const captured: Captured = { writes: [] };
    const updateBookMetadata = vi.fn<(b: Book) => Promise<void>>(async () => {});
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 100 })],
      }),
      captured,
    });

    await new FileSyncEngine(provider, fakeStore({ updateBookMetadata })).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'send', syncBooks: false, deviceId: 'pc' },
    );

    expect(updateBookMetadata).not.toHaveBeenCalled();
    expect(pushedIndex(captured)!.books.find((b) => b.hash === 'h1')!.updatedAt).toBe(200);
  });

  test('a peer revives its tombstone from the stamped row', async () => {
    // The other half of the handshake: given the row the test above publishes,
    // the peer that holds the tombstone must put the book back on its shelf.
    const addBookToLibrary = vi.fn<(b: Book) => Promise<void>>(async () => {});
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 5001 })],
      }),
      list: async (p) =>
        p.endsWith('/books')
          ? [{ name: 'h1', path: '/Readest/books/h1', isDirectory: true }]
          : [
              {
                name: 'Book h1.epub',
                path: '/Readest/books/h1/Book h1.epub',
                isDirectory: false,
                size: 10,
              },
            ],
    });

    const res = await new FileSyncEngine(provider, fakeStore({ addBookToLibrary })).syncLibrary(
      [makeBook('h1', { updatedAt: 5000, deletedAt: 5000 })],
      { strategy: 'silent', syncBooks: false, fullSync: true, deviceId: 'boox' },
    );

    expect(res.booksAdded).toBe(1);
    expect(addBookToLibrary).toHaveBeenCalledTimes(1);
    expect(addBookToLibrary.mock.calls[0]![0].hash).toBe('h1');
  });
});

describe('FileSyncEngine.syncLibrary — two devices converge (#5900)', () => {
  test('a Send Only PC and a peer holding a tombstone settle on one library', async () => {
    // The reporter's exact standoff, played out round by round against one
    // shared remote: the PC keeps a book it last touched at 100, the BOOX
    // deleted it at 5000 and pushed that tombstone. Neither shelf ever
    // changed, run after run. Convergence means the tombstone loses (the PC
    // is the authoritative sender) and STAYS lost.
    let remote = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1', { updatedAt: 100, deletedAt: 5000 })],
    } satisfies RemoteLibraryIndex);

    const sharedRemote = (): Partial<FileSyncProvider> => ({
      readText: async (p) => (p.endsWith('library.json') ? remote : null),
      writeText: async (p, body) => {
        if (p.endsWith('library.json')) remote = body;
      },
      list: async (p) =>
        p.endsWith('/books')
          ? [{ name: 'h1', path: '/Readest/books/h1', isDirectory: true }]
          : [
              {
                name: 'Book h1.epub',
                path: '/Readest/books/h1/Book h1.epub',
                isDirectory: false,
                size: 10,
              },
            ],
    });

    const liveRow = () =>
      (JSON.parse(remote) as RemoteLibraryIndex).books.find((b) => b.hash === 'h1')!;

    // --- Round 1: the PC sends. It must stamp its republish to outrank 5000.
    let pcBooks = [makeBook('h1', { updatedAt: 100 })];
    await new FileSyncEngine(
      fakeProvider(sharedRemote()),
      fakeStore({
        updateBookMetadata: async (b) => {
          pcBooks = [b];
        },
      }),
    ).syncLibrary(pcBooks, { strategy: 'send', syncBooks: false, deviceId: 'pc' });
    expect(liveRow().deletedAt).toBeFalsy();

    // --- Round 2: the BOOX pulls. Its tombstone must give way.
    let booxBooks = [makeBook('h1', { updatedAt: 5000, deletedAt: 5000 })];
    const addBookToLibrary = vi.fn<(b: Book) => Promise<void>>(async (b) => {
      booxBooks = [{ ...b, deletedAt: null }];
    });
    const boox = await new FileSyncEngine(
      fakeProvider(sharedRemote()),
      fakeStore({ addBookToLibrary }),
    ).syncLibrary(booxBooks, { strategy: 'silent', syncBooks: false, deviceId: 'boox' });
    expect(boox.booksAdded).toBe(1);
    expect(booxBooks[0]!.deletedAt).toBeFalsy();
    // The BOOX's own re-push must not put the tombstone back.
    expect(liveRow().deletedAt).toBeFalsy();

    // --- Round 3: the PC sends again. Nothing left to override, so it must
    // stop restamping — a stamp per run would churn the index forever.
    const restamp = vi.fn<(b: Book) => Promise<void>>(async () => {});
    await new FileSyncEngine(
      fakeProvider(sharedRemote()),
      fakeStore({ updateBookMetadata: restamp }),
    ).syncLibrary(pcBooks, { strategy: 'send', syncBooks: false, deviceId: 'pc' });
    expect(restamp).not.toHaveBeenCalled();
    expect(liveRow().deletedAt).toBeFalsy();
  });
});

describe('FileSyncEngine.syncLibrary — concurrent index writers (Full Sync)', () => {
  /**
   * A provider over one shared `library.json` whose FIRST read returns a frozen
   * snapshot — the deterministic stand-in for "this device read the index, then
   * a peer pushed while it was still working". Later reads see the live file.
   */
  const racingProvider = (
    staleSnapshot: string,
    live: { body: string },
    opts: { failReread?: boolean } = {},
  ): FileSyncProvider => {
    let reads = 0;
    return fakeProvider({
      readText: async (p) => {
        if (!p.endsWith('library.json')) return null;
        reads += 1;
        if (reads === 1) return staleSnapshot;
        if (opts.failReread) throw new FileSyncError('offline', 'NETWORK', 503);
        return live.body;
      },
      writeText: async (p, body) => {
        if (p.endsWith('library.json')) live.body = body;
      },
    });
  };

  test('does not drop a peer entry written while this run was working', async () => {
    // This device started from an index holding only h1. While it worked, a
    // peer pushed a book of its own, a confirmed upload, an empty-dir record
    // and a tombstone. Rebuilding from the stale snapshot would erase all four.
    const stale = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1')],
      uploadedHashes: ['h1'],
    } satisfies RemoteLibraryIndex);

    const live = {
      body: JSON.stringify({
        schemaVersion: 1,
        updatedAt: 2,
        books: [makeBook('h1'), makeBook('peer'), makeBook('gone', { deletedAt: 9000 })],
        uploadedHashes: ['h1', 'peer'],
        emptyDirs: ['dir9'],
      } satisfies RemoteLibraryIndex),
    };

    await new FileSyncEngine(racingProvider(stale, live), fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'send', syncBooks: false, fullSync: true, deviceId: 'pc' },
    );

    const idx = JSON.parse(live.body) as RemoteLibraryIndex;
    expect(idx.books.map((b) => b.hash).sort()).toEqual(['gone', 'h1', 'peer']);
    expect(idx.books.find((b) => b.hash === 'gone')!.deletedAt).toBe(9000);
    expect(idx.uploadedHashes).toEqual(expect.arrayContaining(['h1', 'peer']));
    expect(idx.emptyDirs).toEqual(['dir9']);
  });

  test('this run still wins for the books it actually owns', async () => {
    // Folding the peer's entries in must not turn the re-push into a pull:
    // 'send' remains authoritative for its own rows.
    const stale = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1', { title: 'Old' })],
    } satisfies RemoteLibraryIndex);
    const live = {
      body: JSON.stringify({
        schemaVersion: 1,
        updatedAt: 2,
        books: [makeBook('h1', { title: 'Peer Wrote This' })],
      } satisfies RemoteLibraryIndex),
    };

    await new FileSyncEngine(racingProvider(stale, live), fakeStore()).syncLibrary(
      [makeBook('h1', { title: 'Mine', updatedAt: 200 })],
      { strategy: 'send', syncBooks: false, fullSync: true, deviceId: 'pc' },
    );

    expect((JSON.parse(live.body) as RemoteLibraryIndex).books[0]!.title).toBe('Mine');
  });

  test('a backend with no etag skips the discovery scan on an unchanged index', async () => {
    // iCloud has no etag at all and many WebDAV servers omit it, so the etag
    // short-circuit never fired for them and every incremental sync re-listed
    // the whole remote books/ directory. The index content answers the same
    // question — nobody wrote since — and we already downloaded it.
    const idx = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1')],
      uploadedHashes: ['h1'],
    } satisfies RemoteLibraryIndex);
    let lists = 0;
    const provider = fakeProvider({
      head: async () => null, // no etag, like iCloud
      readText: async (p) => (p.endsWith('library.json') ? idx : null),
      list: async () => {
        lists += 1;
        return [];
      },
    });
    const opts = { strategy: 'silent', syncBooks: false, deviceId: 'pc' } as const;

    await new FileSyncEngine(provider, fakeStore()).syncLibrary([makeBook('h1')], opts);
    expect(lists).toBeGreaterThan(0); // first run has no snapshot: it scans

    lists = 0;
    await new FileSyncEngine(provider, fakeStore()).syncLibrary([makeBook('h1')], opts);
    expect(lists).toBe(0);
  });

  test('an incremental run never re-reads the index before pushing', async () => {
    // The incremental path's contract is speed: it is best-effort, runs
    // unattended on every library change, and must not pay a second GET of
    // library.json (tens to hundreds of KB) to win a race it is allowed to
    // lose. Losing one is self-healing anyway — membership is a union-by-hash
    // CRDT, so the device that owns a dropped row re-publishes it.
    const stale = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1')],
    } satisfies RemoteLibraryIndex);
    const live = { body: stale };
    let libraryReads = 0;
    const provider = fakeProvider({
      readText: async (p) => {
        if (!p.endsWith('library.json')) return null;
        libraryReads += 1;
        return live.body;
      },
      writeText: async (p, body) => {
        if (p.endsWith('library.json')) live.body = body;
      },
    });

    await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'send', syncBooks: false, fullSync: false, deviceId: 'pc' },
    );

    expect(libraryReads).toBe(1);
  });

  test('the fold does not resurrect an empty-dir record this run disproved', async () => {
    // Folding the peer's records back in must not undo newer knowledge: this
    // run listed hx and found a book file in it, so the peer's "hx is empty"
    // entry is stale, not a competing addition.
    const stale = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 1,
      books: [],
      emptyDirs: [],
    } satisfies RemoteLibraryIndex);
    const live = {
      body: JSON.stringify({
        schemaVersion: 1,
        updatedAt: 2,
        books: [],
        emptyDirs: ['hx'],
      } satisfies RemoteLibraryIndex),
    };

    let reads = 0;
    const provider = fakeProvider({
      readText: async (p) => {
        if (!p.endsWith('library.json')) return null;
        reads += 1;
        return reads === 1 ? stale : live.body;
      },
      writeText: async (p, body) => {
        if (p.endsWith('library.json')) live.body = body;
      },
      list: async (p) =>
        p.endsWith('/books')
          ? [{ name: 'hx', path: '/Readest/books/hx', isDirectory: true }]
          : [
              {
                name: 'Book hx.epub',
                path: '/Readest/books/hx/Book hx.epub',
                isDirectory: false,
                size: 10,
              },
            ],
    });

    await new FileSyncEngine(provider, fakeStore()).syncLibrary([], {
      strategy: 'silent',
      syncBooks: false,
      fullSync: true,
      deviceId: 'pc',
    });

    expect((JSON.parse(live.body) as RemoteLibraryIndex).emptyDirs).not.toContain('hx');
  });

  test('skips the push rather than clobbering when the pre-push re-read fails', async () => {
    const stale = JSON.stringify({
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1')],
    } satisfies RemoteLibraryIndex);
    const live = { body: 'PEER STATE MUST SURVIVE' };

    const res = await new FileSyncEngine(
      racingProvider(stale, live, { failReread: true }),
      fakeStore(),
    ).syncLibrary([makeBook('h1', { updatedAt: 200 })], {
      strategy: 'send',
      syncBooks: false,
      fullSync: true,
      deviceId: 'pc',
    });

    expect(live.body).toBe('PEER STATE MUST SURVIVE');
    expect(res.indexPushFailed).toBe(true);
  });
});

describe('FileSyncEngine.syncLibrary — index write failure is reported (#5900)', () => {
  test('surfaces a failed library.json write instead of swallowing it', async () => {
    const provider = fakeProvider({
      readText: indexServing({ schemaVersion: 1, updatedAt: 1, books: [makeBook('h1')] }),
      writeText: async (p) => {
        if (p.endsWith('library.json')) throw new Error('507 Insufficient Storage');
      },
    });

    const res = await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'pc' },
    );

    expect(res.indexPushFailed).toBe(true);
  });

  test('reports a healthy run as not failed', async () => {
    const provider = fakeProvider({
      readText: indexServing({ schemaVersion: 1, updatedAt: 1, books: [makeBook('h1')] }),
    });

    const res = await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'pc' },
    );

    expect(res.indexPushFailed).toBe(false);
  });
});
