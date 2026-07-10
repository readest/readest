import { describe, expect, test, vi } from 'vitest';

import type { Book, BookConfig } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteBookConfig, RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * Coverage for the engine paths the behavior-preservation gate
 * (engine-metadata-sync) does not execute: streaming upload + HEAD
 * short-circuit, remote-only discovery -> streaming download -> addBook, and
 * the receive (pull-only) strategy. These carry the OOM-avoidance and
 * idempotency value of the original WebDAV sync.
 */

const makeBook = (hash: string, overrides: Partial<Book> = {}): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
  sourceTitle: `Book ${hash}`,
  author: 'A',
  createdAt: 1,
  updatedAt: 1,
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
  uploadStream: opts.uploadStream,
  downloadStream: opts.downloadStream,
});

const fakeStore = (opts: Partial<LocalStore> = {}): LocalStore => ({
  loadConfig: opts.loadConfig ?? (async () => null),
  saveBookConfig: opts.saveBookConfig ?? (async () => {}),
  loadBookFile: opts.loadBookFile ?? (async () => null),
  resolveLocalBookPath: opts.resolveLocalBookPath ?? (async () => null),
  saveBookFile: opts.saveBookFile ?? (async () => {}),
  prepareLocalBookPath: opts.prepareLocalBookPath ?? (async () => '/local/dst'),
  loadBookCover: opts.loadBookCover ?? (async () => null),
  saveBookCover: opts.saveBookCover ?? (async () => {}),
  addBookToLibrary: opts.addBookToLibrary ?? (async () => {}),
  updateBookMetadata: opts.updateBookMetadata ?? (async () => {}),
  deleteBookLocally: opts.deleteBookLocally ?? (async () => {}),
});

describe('FileSyncEngine.pushBookFile — streaming upload', () => {
  test('streams via provider.uploadStream when remote is missing', async () => {
    const uploadStream = vi.fn(async () => true);
    const provider = fakeProvider({ head: async () => null, uploadStream });
    const store = fakeStore({
      resolveLocalBookPath: async () => ({ path: '/local/x.epub', size: 100 }),
    });

    const res = await new FileSyncEngine(provider, store).pushBookFile(makeBook('h1'));

    expect(res).toEqual({ uploaded: true });
    expect(uploadStream).toHaveBeenCalledTimes(1);
    expect(uploadStream).toHaveBeenCalledWith(
      expect.stringContaining('/Readest/books/h1/'),
      '/local/x.epub',
    );
  });

  test('HEAD size match short-circuits without uploading', async () => {
    const uploadStream = vi.fn(async () => true);
    const provider = fakeProvider({ head: async () => ({ size: 100 }), uploadStream });
    const store = fakeStore({
      resolveLocalBookPath: async () => ({ path: '/local/x.epub', size: 100 }),
    });

    const res = await new FileSyncEngine(provider, store).pushBookFile(makeBook('h1'));

    expect(res).toEqual({ uploaded: false, reason: 'remote-matches' });
    expect(uploadStream).not.toHaveBeenCalled();
  });

  test('retries the stream once before failing', async () => {
    const uploadStream = vi
      .fn<(remotePath: string, localPath: string) => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const provider = fakeProvider({ head: async () => null, uploadStream });
    const store = fakeStore({
      resolveLocalBookPath: async () => ({ path: '/local/x.epub', size: 100 }),
    });

    const res = await new FileSyncEngine(provider, store).pushBookFile(makeBook('h1'));

    expect(res).toEqual({ uploaded: true });
    expect(uploadStream).toHaveBeenCalledTimes(2);
  });
});

describe('FileSyncEngine.syncLibrary — remote discovery + streaming download', () => {
  test('discovers a remote-only book, streams it down, and adds it to the library', async () => {
    const downloadStream = vi.fn(async () => true);
    const provider = fakeProvider({
      list: async (path: string) =>
        path.endsWith('/books')
          ? [{ name: 'h2', path: '/Readest/books/h2', isDirectory: true }]
          : [
              {
                name: 'Remote.epub',
                path: '/Readest/books/h2/Remote.epub',
                isDirectory: false,
                size: 50,
              },
            ],
      downloadStream,
    });
    const addBookToLibrary = vi.fn<(book: Book) => Promise<void>>(async () => {});
    const prepareLocalBookPath = vi.fn(async () => '/local/h2/Remote.epub');
    const store = fakeStore({ addBookToLibrary, prepareLocalBookPath });

    const res = await new FileSyncEngine(provider, store).syncLibrary([], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'd',
    });

    expect(downloadStream).toHaveBeenCalledWith(
      '/Readest/books/h2/Remote.epub',
      '/local/h2/Remote.epub',
    );
    expect(addBookToLibrary).toHaveBeenCalledTimes(1);
    expect(addBookToLibrary.mock.calls[0]![0].hash).toBe('h2');
    expect(res.booksDownloaded).toBe(1);
  });
});

// The explicit per-book Download action (Book Details / bookshelf cloud
// button) routed to a third-party provider: fetch the binary from the hash
// dir (filename resolved by listing — titles go stale), plus cover + config
// best-effort.
describe('FileSyncEngine.downloadBookFile', () => {
  const hashDirListing = (withFile: boolean) => async (p: string) => {
    if (!p.endsWith('/books/h1')) return [];
    const entries = [
      { name: 'config.json', path: '/Readest/books/h1/config.json', isDirectory: false, size: 1 },
      { name: 'cover.png', path: '/Readest/books/h1/cover.png', isDirectory: false, size: 2 },
    ];
    if (withFile)
      entries.push({
        name: 'B.epub',
        path: '/Readest/books/h1/B.epub',
        isDirectory: false,
        size: 9,
      });
    return entries;
  };

  test('downloads the book file into the local store', async () => {
    const saveBookFile = vi.fn(async () => {});
    const provider = fakeProvider({
      list: hashDirListing(true),
      readBinary: async () => new ArrayBuffer(9),
    });
    const store = fakeStore({ saveBookFile });

    const ok = await new FileSyncEngine(provider, store).downloadBookFile(makeBook('h1'));

    expect(ok).toBe(true);
    expect(saveBookFile).toHaveBeenCalledTimes(1);
  });

  test('returns false when the remote holds no book file', async () => {
    const saveBookFile = vi.fn(async () => {});
    const provider = fakeProvider({ list: hashDirListing(false) });
    const store = fakeStore({ saveBookFile });

    const ok = await new FileSyncEngine(provider, store).downloadBookFile(makeBook('h1'));

    expect(ok).toBe(false);
    expect(saveBookFile).not.toHaveBeenCalled();
  });

  test('prefers the streaming downloader when available', async () => {
    const downloadStream = vi.fn(async () => true);
    const prepareLocalBookPath = vi.fn(async () => '/local/h1/B.epub');
    const provider = fakeProvider({ list: hashDirListing(true), downloadStream });
    const store = fakeStore({ prepareLocalBookPath });

    const ok = await new FileSyncEngine(provider, store).downloadBookFile(makeBook('h1'));

    expect(ok).toBe(true);
    expect(downloadStream).toHaveBeenCalledWith('/Readest/books/h1/B.epub', '/local/h1/B.epub');
  });
});

describe('FileSyncEngine.syncLibrary — receive strategy is pull-only', () => {
  test('never writes (no config push, no index re-push) under receive', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({ captured });
    const store = fakeStore({ loadConfig: async () => ({ updatedAt: 1, booknotes: [] }) });

    const res = await new FileSyncEngine(provider, store).syncLibrary([makeBook('h1')], {
      strategy: 'receive',
      syncBooks: true,
      deviceId: 'd',
    });

    expect(captured.writes).toHaveLength(0);
    expect(res.configsUploaded).toBe(0);
    expect(res.filesUploaded).toBe(0);
  });
});

const makeIndex = (books: Book[], uploadedHashes?: string[]): RemoteLibraryIndex => ({
  schemaVersion: 1,
  updatedAt: 1,
  books,
  ...(uploadedHashes ? { uploadedHashes } : {}),
});

const makeEnvelope = (over: Partial<RemoteBookConfig> = {}): RemoteBookConfig => ({
  schemaVersion: 1,
  bookHash: 'h1',
  config: { updatedAt: 100 },
  booknotes: [],
  writerDeviceId: 'peer',
  writerVersion: 'readest-webdav-1',
  updatedAt: 100,
  ...over,
});

const configWrites = (captured: Captured) =>
  captured.writes.filter((w) => w.path.endsWith('config.json'));

describe('FileSyncEngine.syncLibrary — incremental diff (default)', () => {
  test('skips a book whose updatedAt matches the remote index', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : null,
      captured,
    });
    const store = fakeStore({ loadConfig: async () => ({ updatedAt: 1, booknotes: [] }) });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      {
        strategy: 'silent',
        syncBooks: false,
        deviceId: 'd',
      },
    );

    expect(configWrites(captured)).toHaveLength(0);
    expect(res.configsUploaded).toBe(0);
    expect(res.booksSynced).toBe(0);
    // Nothing changed, so the byte-identical index is NOT re-pushed — a
    // restamped copy would only churn the remote and defeat every other
    // device's change detection.
    expect(captured.writes.some((w) => w.path.endsWith('library.json'))).toBe(false);
  });

  test('pushes a book that is newer locally than the index', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : null,
      captured,
    });
    const store = fakeStore({ loadConfig: async () => ({ updatedAt: 1, booknotes: [] }) });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      {
        strategy: 'silent',
        syncBooks: false,
        deviceId: 'd',
      },
    );

    expect(res.configsUploaded).toBe(1);
    expect(res.booksSynced).toBe(1);
    expect(configWrites(captured)).toHaveLength(1);
  });

  test('pulls config + metadata for a book newer in the index', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) => {
        if (p.endsWith('library.json'))
          return JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 200, title: 'Remote' })]));
        if (p.endsWith('config.json'))
          return JSON.stringify(makeEnvelope({ config: { updatedAt: 200, progress: [9, 10] } }));
        return null;
      },
      captured,
    });
    const saveBookConfig = vi.fn(async () => {});
    const updateBookMetadata = vi.fn(async () => {});
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      saveBookConfig,
      updateBookMetadata,
    });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      {
        strategy: 'silent',
        syncBooks: false,
        deviceId: 'd',
      },
    );

    expect(res.metadataUpdated).toBe(1);
    expect(res.configsDownloaded).toBe(1);
    expect(res.booksSynced).toBe(1);
    expect(saveBookConfig).toHaveBeenCalledTimes(1);
    // Remote is newer, so the book is NOT in the push set — no config.json PUT.
    expect(configWrites(captured)).toHaveLength(0);
  });

  // #4856: enabling "Upload Book Files" AFTER the first (config-only) sync must
  // upload the file even though the book's config is already in sync with the
  // index (its updatedAt is unchanged, so the incremental cursor would skip it).
  test('uploads the file when syncBooks is enabled after a config-only first sync', async () => {
    const captured: Captured = { writes: [] };
    const binaryWrites: string[] = [];
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : null,
      head: async () => null, // no book file on the remote yet
      writeBinary: async (path: string) => {
        binaryWrites.push(path);
      },
      captured,
    });
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile: async () => ({ bytes: new ArrayBuffer(10), size: 10 }),
    });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, downloadedAt: 1 })],
      {
        strategy: 'silent',
        syncBooks: true,
        deviceId: 'd',
      },
    );

    expect(res.filesUploaded).toBe(1);
    expect(binaryWrites.some((p) => p.includes('/Readest/books/h1/'))).toBe(true);
    // The config is already in sync, so it must NOT be re-pushed.
    expect(configWrites(captured)).toHaveLength(0);
    // The upload is recorded so the next incremental sync skips the probe.
    const idx = JSON.parse(
      captured.writes.find((w) => w.path.endsWith('library.json'))!.body,
    ) as RemoteLibraryIndex;
    expect(idx.uploadedHashes).toContain('h1');
  });

  test('skips the file when the remote already has a same-size copy (syncBooks on)', async () => {
    const captured: Captured = { writes: [] };
    const binaryWrites: string[] = [];
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : null,
      head: async () => ({ size: 10 }), // remote already has the file, same size
      writeBinary: async (path: string) => {
        binaryWrites.push(path);
      },
      captured,
    });
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile: async () => ({ bytes: new ArrayBuffer(10), size: 10 }),
    });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, downloadedAt: 1 })],
      {
        strategy: 'silent',
        syncBooks: true,
        deviceId: 'd',
      },
    );

    expect(res.filesUploaded).toBe(0);
    expect(res.filesAlreadyInSync).toBe(1);
    expect(binaryWrites).toHaveLength(0);
    expect(configWrites(captured)).toHaveLength(0);
    // The freshly-verified file is now recorded so the next sync skips it.
    const idx = JSON.parse(
      captured.writes.find((w) => w.path.endsWith('library.json'))!.body,
    ) as RemoteLibraryIndex;
    expect(idx.uploadedHashes).toContain('h1');
  });

  // A device that holds no local copy of a book (e.g. web with a cloud-only
  // library) can never upload it, so the remote probe buys nothing — and at
  // library scale it is a full per-book request storm on every sync. The
  // no-source verdict must be reached from local state alone, with zero
  // remote traffic; the device that does hold the bytes uploads and records.
  test('spends no remote request on a no-source book', async () => {
    const captured: Captured = { writes: [] };
    const head = vi.fn(async () => ({ size: 10 }));
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : null,
      head,
      captured,
    });
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile: async () => null, // no local copy on this device
    });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: true, deviceId: 'd' },
    );

    expect(head).not.toHaveBeenCalledWith(expect.stringContaining('/books/'));
    expect(res.filesUploaded).toBe(0);
    // Nothing recorded and nothing changed: the index is not re-pushed.
    expect(captured.writes.some((w) => w.path.endsWith('library.json'))).toBe(false);
  });

  test('leaves a no-source book unrecorded when the remote lacks it too', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : null,
      head: async () => null, // not on the remote either
      captured,
    });
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile: async () => null, // no local copy on this device
    });

    await new FileSyncEngine(provider, store).syncLibrary([makeBook('h1', { updatedAt: 100 })], {
      strategy: 'silent',
      syncBooks: true,
      deviceId: 'd',
    });

    // A device that does have the file must still be able to upload and
    // record it later: nothing was recorded (no index write at all).
    expect(captured.writes.some((w) => w.path.endsWith('library.json'))).toBe(false);
  });

  // #4856 perf: once a file is recorded in the index, an incremental sync must
  // NOT HEAD-probe it again — the steady state stays O(changed), not O(library).
  test('does not probe an already-recorded file (stays O(changed))', async () => {
    const captured: Captured = { writes: [] };
    const head = vi.fn(async () => null);
    const loadBookFile = vi.fn(async () => ({ bytes: new ArrayBuffer(10), size: 10 }));
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })], ['h1']))
          : null,
      head,
      captured,
    });
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile,
    });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: true, deviceId: 'd' },
    );

    // No file work at all: no HEAD probe on the book, no bytes read, no upload.
    expect(head).not.toHaveBeenCalledWith(expect.stringContaining('/books/'));
    expect(loadBookFile).not.toHaveBeenCalled();
    expect(res.filesUploaded).toBe(0);
    expect(res.filesAlreadyInSync).toBe(0);
    expect(res.booksSynced).toBe(0);
    // Nothing changed, so the index (and its record) is left untouched.
    expect(captured.writes.some((w) => w.path.endsWith('library.json'))).toBe(false);
  });

  test('fullSync re-probes a recorded file (drift escape hatch)', async () => {
    const head = vi.fn(async () => ({ size: 10 }));
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })], ['h1']))
          : null,
      head,
      captured: { writes: [] },
    });
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile: async () => ({ bytes: new ArrayBuffer(10), size: 10 }),
    });

    await new FileSyncEngine(provider, store).syncLibrary([makeBook('h1', { updatedAt: 100 })], {
      strategy: 'silent',
      syncBooks: true,
      deviceId: 'd',
      fullSync: true,
    });

    // Full Sync bypasses the record and re-verifies the file.
    expect(head).toHaveBeenCalled();
  });

  test('fullSync re-pushes an in-sync book', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : null,
      captured,
    });
    const store = fakeStore({ loadConfig: async () => ({ updatedAt: 1, booknotes: [] }) });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      {
        strategy: 'silent',
        syncBooks: false,
        deviceId: 'd',
        fullSync: true,
      },
    );

    expect(res.configsUploaded).toBe(1);
    expect(configWrites(captured)).toHaveLength(1);
  });
});

describe('FileSyncEngine.syncLibrary — bounded concurrency', () => {
  const runWithConcurrency = async (concurrency: number | undefined, bookCount: number) => {
    let inFlight = 0;
    let maxInFlight = 0;
    const loadConfig = async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { updatedAt: 1, booknotes: [] };
    };
    const books = Array.from({ length: bookCount }, (_, i) =>
      makeBook(`h${i}`, { updatedAt: 100 }),
    );
    // No remote index -> every book is local-only -> all pushed.
    const provider = fakeProvider({ captured: { writes: [] } });
    const store = fakeStore({ loadConfig });
    const res = await new FileSyncEngine(provider, store).syncLibrary(books, {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'd',
      concurrency,
    });
    return { res, maxInFlight };
  };

  test('caps in-flight work at the configured concurrency', async () => {
    const { res, maxInFlight } = await runWithConcurrency(3, 8);
    expect(res.configsUploaded).toBe(8);
    expect(res.booksSynced).toBe(8);
    expect(maxInFlight).toBe(3);
  });

  test('defaults to 4 when concurrency is omitted', async () => {
    const { res, maxInFlight } = await runWithConcurrency(undefined, 8);
    expect(res.configsUploaded).toBe(8);
    expect(maxInFlight).toBe(4);
  });

  test('concurrency 1 runs strictly sequentially', async () => {
    const { res, maxInFlight } = await runWithConcurrency(1, 4);
    expect(res.configsUploaded).toBe(4);
    expect(maxInFlight).toBe(1);
  });
});

// The idle-run request budget: a sync where nothing changed on either side
// must cost ONE metadata stat — no index download, no discovery listing, no
// index re-push. The remote etag (Drive md5 / WebDAV ETag) is the change
// signal: every peer mutation rewrites library.json, so an unchanged etag
// means no remote-side news. The cache is keyed on the (memoised) provider,
// so it survives across engine builds within a session.
describe('FileSyncEngine.syncLibrary — remote change detection', () => {
  const opts = { strategy: 'silent', syncBooks: false, deviceId: 'd' } as const;
  const indexWrites = (captured: Captured) =>
    captured.writes.filter((w) => w.path.endsWith('library.json'));

  const makeChangeProbeHarness = (etagOf: () => string) => {
    const captured: Captured = { writes: [] };
    const readText = vi.fn(async (p: string) =>
      p.endsWith('library.json')
        ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
        : null,
    );
    const head = vi.fn(async (p: string) =>
      p.endsWith('library.json') ? { etag: etagOf() } : null,
    );
    const list = vi.fn(async () => []);
    const provider = fakeProvider({ readText, head, list, captured });
    const store = fakeStore({ loadConfig: async () => ({ updatedAt: 1, booknotes: [] }) });
    return { captured, readText, head, list, provider, store };
  };

  test('an unchanged remote index short-circuits: no pull, no discovery, no push', async () => {
    const h = makeChangeProbeHarness(() => 'E1');
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      opts,
    );
    expect(h.readText).toHaveBeenCalledTimes(1); // first run pulls
    expect(h.list).toHaveBeenCalled(); // and discovers

    h.readText.mockClear();
    h.list.mockClear();
    // Fresh engine, same provider — mirrors one engine build per sync run.
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      opts,
    );
    expect(h.readText).not.toHaveBeenCalled();
    expect(h.list).not.toHaveBeenCalled();
    expect(indexWrites(h.captured)).toHaveLength(0); // clean on both runs
  });

  test('a local change under an unchanged remote index pushes without re-pulling', async () => {
    const h = makeChangeProbeHarness(() => 'E1');
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      opts,
    );

    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      opts,
    );
    // The index itself was never re-pulled (the push loop's config pull-merge
    // reads config.json, which also goes through readText).
    const libraryReads = h.readText.mock.calls.filter((c) => String(c[0]).endsWith('library.json'));
    expect(libraryReads).toHaveLength(1);
    expect(configWrites(h.captured)).toHaveLength(1);
    expect(indexWrites(h.captured)).toHaveLength(1);
  });

  test('a changed remote etag re-pulls the index', async () => {
    let etag = 'E1';
    const h = makeChangeProbeHarness(() => etag);
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      opts,
    );
    etag = 'E2';
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      opts,
    );
    expect(h.readText).toHaveBeenCalledTimes(2);
  });

  test('a local tombstone missing from the remote index still pushes the index', async () => {
    const h = makeChangeProbeHarness(() => 'E1');
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, deletedAt: 150 })],
      opts,
    );
    // No per-book counters fire for a tombstone, but the index MUST publish it.
    const idx = JSON.parse(indexWrites(h.captured)[0]!.body) as RemoteLibraryIndex;
    expect(idx.books.find((b) => b.hash === 'h1')?.deletedAt).toBe(150);
  });
});

// File-less hash dirs (config/cover only — legacy junk or peers that sync
// without "Upload Book Files") used to be re-listed by discovery on every
// run, forever. They are now recorded in the index once inspected and only
// re-checked when the index says their file arrived (uploadedHashes), or on
// a Full Sync.
describe('FileSyncEngine.syncLibrary — empty-dir record', () => {
  const opts = { strategy: 'silent', syncBooks: false, deviceId: 'd' } as const;
  const orphanListing = (withFile: boolean) => async (p: string) => {
    if (p.endsWith('/books')) return [{ name: 'h9', path: '/Readest/books/h9', isDirectory: true }];
    const entries = [
      { name: 'config.json', path: '/Readest/books/h9/config.json', isDirectory: false, size: 1 },
    ];
    if (withFile)
      entries.push({
        name: 'B.epub',
        path: '/Readest/books/h9/B.epub',
        isDirectory: false,
        size: 9,
      });
    return entries;
  };

  test('records an inspected file-less dir in the index', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h9', { updatedAt: 100 })]))
          : null,
      list: orphanListing(false),
      captured,
    });
    const res = await new FileSyncEngine(provider, fakeStore()).syncLibrary([], opts);

    expect(res.booksDownloaded).toBe(0);
    const idx = JSON.parse(
      captured.writes.find((w) => w.path.endsWith('library.json'))!.body,
    ) as RemoteLibraryIndex;
    expect(idx.emptyDirs).toContain('h9');
  });

  test('skips a recorded file-less dir on the next discovery', async () => {
    const captured: Captured = { writes: [] };
    const list = vi.fn(orphanListing(false));
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify({
              ...makeIndex([makeBook('h9', { updatedAt: 100 })]),
              emptyDirs: ['h9'],
            })
          : null,
      list,
      captured,
    });
    await new FileSyncEngine(provider, fakeStore()).syncLibrary([], opts);

    expect(list).toHaveBeenCalledWith(expect.stringContaining('/books'));
    expect(list).not.toHaveBeenCalledWith('/Readest/books/h9');
    // Nothing changed — the record survives by NOT re-pushing the index.
    expect(captured.writes.some((w) => w.path.endsWith('library.json'))).toBe(false);
  });

  test('re-inspects a recorded dir once the index says its file arrived', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify({
              ...makeIndex([makeBook('h9', { updatedAt: 100 })], ['h9']),
              emptyDirs: ['h9'],
            })
          : null,
      list: orphanListing(true),
      readBinary: async () => new ArrayBuffer(9),
      captured,
    });
    const addBookToLibrary = vi.fn(async () => {});
    const res = await new FileSyncEngine(provider, fakeStore({ addBookToLibrary })).syncLibrary(
      [],
      opts,
    );

    expect(res.booksDownloaded).toBe(1);
    const idx = JSON.parse(
      captured.writes.find((w) => w.path.endsWith('library.json'))!.body,
    ) as RemoteLibraryIndex;
    expect(idx.emptyDirs ?? []).not.toContain('h9');
  });
});

// Row-as-truth: the library row is authoritative for local file presence
// (import / download / delete all stamp downloadedAt; merges never let a
// peer clobber it). A book the row marks as absent is skipped without a
// single filesystem or remote probe — incremental sync stays pure metadata
// diffing. Row-vs-filesystem split-brain is healed by Full Sync, which
// bypasses the gate and audits the real filesystem.
describe('FileSyncEngine.syncLibrary — row-as-truth local file gate', () => {
  test('a book whose row marks no local file is never probed at all', async () => {
    const head = vi.fn(async (p: string) => (p.endsWith('library.json') ? { etag: 'E9' } : null));
    const provider = fakeProvider({
      head,
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
          : null,
      captured: { writes: [] },
    });
    const loadBookFile = vi.fn(async () => null);
    const resolveLocalBookPath = vi.fn(async () => null);
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile,
      resolveLocalBookPath,
    });

    // No downloadedAt, no filePath: this device has never had the file.
    await new FileSyncEngine(provider, store).syncLibrary([makeBook('h1', { updatedAt: 100 })], {
      strategy: 'silent',
      syncBooks: true,
      deviceId: 'd',
    });

    expect(loadBookFile).not.toHaveBeenCalled();
    expect(resolveLocalBookPath).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalledWith(expect.stringContaining('/books/'));
  });
});

// The plugin:fs|exists storm (Tauri): every sync run re-walked all books
// whose file is recorded nowhere, paying two local fs probes per book per
// run just to relearn "no local source". The verdict is now memoised per
// provider session, keyed to the book's updatedAt — an unchanged library
// costs zero local and zero remote probes on repeat runs; only a locally
// updated book, Full Sync, or a fresh session re-qualifies a probe.
describe('FileSyncEngine.syncLibrary — no-source probe memo', () => {
  const opts = { strategy: 'silent', syncBooks: true, deviceId: 'd' } as const;

  const makeProbeHarness = () => {
    const head = vi.fn(async (p: string) => (p.endsWith('library.json') ? { etag: 'E1' } : null));
    const readText = vi.fn(async (p: string) =>
      p.endsWith('library.json')
        ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100 })]))
        : null,
    );
    const provider = fakeProvider({ head, readText, captured: { writes: [] } });
    // Drifted row: downloadedAt claims a local file, the filesystem disagrees.
    const loadBookFile = vi.fn(async () => null);
    const resolveLocalBookPath = vi.fn(async () => null);
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile,
      resolveLocalBookPath,
    });
    return { provider, store, head, loadBookFile };
  };

  test('an unchanged no-source book is probed once per provider session', async () => {
    const h = makeProbeHarness();
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, downloadedAt: 1 })],
      opts,
    );
    expect(h.loadBookFile).toHaveBeenCalledTimes(1); // first run learns the verdict

    // Fresh engine, same (memoised) provider — one engine build per sync run.
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, downloadedAt: 1 })],
      opts,
    );
    expect(h.loadBookFile).toHaveBeenCalledTimes(1); // no local re-probe
    expect(h.head).not.toHaveBeenCalledWith(expect.stringContaining('/books/')); // no remote probe
  });

  test('a locally updated book is probed again', async () => {
    const h = makeProbeHarness();
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, downloadedAt: 1 })],
      opts,
    );
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 200, downloadedAt: 1 })],
      opts,
    );
    expect(h.loadBookFile).toHaveBeenCalledTimes(2);
  });

  test('fullSync bypasses the memo', async () => {
    const h = makeProbeHarness();
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, downloadedAt: 1 })],
      opts,
    );
    await new FileSyncEngine(h.provider, h.store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, downloadedAt: 1 })],
      { ...opts, fullSync: true },
    );
    expect(h.loadBookFile).toHaveBeenCalledTimes(2);
  });
});

// The engine passes the FULL ancestor chain to ensureDir for every book, so a
// stateless provider (OneDrive create-folder, WebDAV MKCOL) re-creates the
// shared parents (/Readest, /Readest/books) on each book — a redundant round
// trip and a 409 "name already exists" flood at library scale. The engine now
// memoises ensured dirs (+ single-flights concurrent creates) for the session.
describe('FileSyncEngine — ensureDir session cache', () => {
  const cfg = { updatedAt: 1, booknotes: [] } as unknown as BookConfig;

  test('creates each shared parent once across books', async () => {
    const ensured: string[] = [];
    const provider = fakeProvider({
      captured: { writes: [] },
      ensureDir: async (paths: string[]) => {
        ensured.push(...paths);
      },
    });
    const engine = new FileSyncEngine(provider, fakeStore());
    await engine.pushBookConfig(makeBook('h1'), cfg, 'd');
    await engine.pushBookConfig(makeBook('h2'), cfg, 'd');

    // The shared parents are created exactly once despite two books...
    expect(ensured.filter((d) => d === '/Readest')).toHaveLength(1);
    expect(ensured.filter((d) => d === '/Readest/books')).toHaveLength(1);
    // ...while each book's own hash dir is still created.
    expect(ensured.filter((d) => d === '/Readest/books/h1')).toHaveLength(1);
    expect(ensured.filter((d) => d === '/Readest/books/h2')).toHaveLength(1);
  });

  test('single-flights concurrent creates of the same shared parent', async () => {
    let inFlightReadest = 0;
    let maxInFlightReadest = 0;
    const provider = fakeProvider({
      captured: { writes: [] },
      ensureDir: async (paths: string[]) => {
        if (paths[0] === '/Readest') {
          inFlightReadest += 1;
          maxInFlightReadest = Math.max(maxInFlightReadest, inFlightReadest);
          await new Promise((r) => setTimeout(r, 5));
          inFlightReadest -= 1;
        }
      },
    });
    const engine = new FileSyncEngine(provider, fakeStore());
    await Promise.all([
      engine.pushBookConfig(makeBook('h1'), cfg, 'd'),
      engine.pushBookConfig(makeBook('h2'), cfg, 'd'),
      engine.pushBookConfig(makeBook('h3'), cfg, 'd'),
    ]);

    // Three book pushes race to ensure /Readest, but the in-flight lock collapses
    // them to a single create.
    expect(maxInFlightReadest).toBe(1);
  });
});
