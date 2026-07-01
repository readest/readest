import { describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
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

const makeIndex = (books: Book[]): RemoteLibraryIndex => ({
  schemaVersion: 1,
  updatedAt: 1,
  books,
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
    // The index itself is still re-pushed.
    expect(captured.writes.some((w) => w.path.endsWith('library.json'))).toBe(true);
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
