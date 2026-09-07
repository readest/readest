import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book, BookConfig } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * Cover repair for rows that already exist locally (#5931).
 *
 * A book restored by Readest Cloud lands in the library as a metadata-only
 * row: no book file, no cover. Being in `allBooksMap` used to be treated as
 * proof that the local resources were complete, so the file-sync discovery
 * pass skipped it and the push pass only ever tried to upload a cover this
 * device didn't have. These tests pin the repair: when the remote holds a
 * cover the local row is missing, sync pulls it down.
 */

const COVER_PATH_SUFFIX = 'cover.png';

const makeBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'h1',
  format: 'EPUB',
  title: 'Restored Book',
  sourceTitle: 'Restored Book',
  author: 'Author',
  createdAt: 1,
  updatedAt: 100,
  ...overrides,
});

const makeIndex = (books: Book[]): RemoteLibraryIndex => ({
  schemaVersion: 1,
  updatedAt: 100,
  books,
  uploadedHashes: books.map((b) => b.hash),
});

/**
 * Provider routed by path. `remoteCover` null models a remote that never
 * received a cover for this hash, so both the HEAD probe and the GET 404.
 */
const makeProvider = (
  index: RemoteLibraryIndex | null,
  remoteCover: ArrayBuffer | null,
): FileSyncProvider => ({
  rootPath: '/',
  readText: vi.fn(async (path: string) =>
    path.endsWith('library.json') && index ? JSON.stringify(index) : null,
  ),
  readBinary: vi.fn(async (path: string) =>
    path.endsWith(COVER_PATH_SUFFIX) ? remoteCover : null,
  ),
  head: vi.fn(async (path: string) =>
    path.endsWith(COVER_PATH_SUFFIX) && remoteCover
      ? { size: remoteCover.byteLength, etag: 'cover-etag' }
      : null,
  ),
  list: vi.fn(async () => []),
  writeText: vi.fn(async () => {}),
  writeBinary: vi.fn(async () => {}),
  ensureDir: vi.fn(async () => {}),
  deleteDir: vi.fn(async () => {}),
});

const makeStore = (overrides: Partial<LocalStore> = {}): LocalStore => ({
  loadConfig: async (): Promise<BookConfig> => ({ updatedAt: 50, booknotes: [] }),
  saveBookConfig: async () => {},
  loadBookFile: async () => null,
  resolveLocalBookPath: async () => null,
  saveBookFile: async () => {},
  prepareLocalBookPath: async () => '/local/path',
  // The defining state of the bug: the row is in the library, the cover file
  // is not on disk.
  loadBookCover: async () => null,
  saveBookCover: async () => {},
  addBookToLibrary: async () => {},
  updateBookMetadata: async () => {},
  deleteBookLocally: async () => {},
  markBooksUploaded: async () => {},
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileSyncEngine cover repair for existing local rows (#5931)', () => {
  test('full sync downloads a remote cover the local row is missing', async () => {
    const book = makeBook();
    const remoteCover = new ArrayBuffer(64);
    const provider = makeProvider(makeIndex([book]), remoteCover);

    const saveBookCover = vi.fn(async (_book: Book, _bytes: ArrayBuffer) => {});
    const updateBookMetadata = vi.fn(async (_book: Book) => {});
    const store = makeStore({ saveBookCover, updateBookMetadata });

    const engine = new FileSyncEngine(provider, store);
    const result = await engine.syncLibrary([book], {
      strategy: 'silent',
      syncBooks: false,
      fullSync: true,
      deviceId: 'phone',
    });

    expect(saveBookCover).toHaveBeenCalledTimes(1);
    expect(saveBookCover.mock.calls[0]![0]!.hash).toBe('h1');
    expect(saveBookCover.mock.calls[0]![1]!.byteLength).toBe(64);
    expect(result.coversDownloaded).toBe(1);
    expect(result.failures).toBe(0);

    // Persisted through the store so the bookshelf regenerates the cover URL
    // instead of showing the generated placeholder until the next reload.
    expect(updateBookMetadata).toHaveBeenCalledTimes(1);
    expect(updateBookMetadata.mock.calls[0]![0]!.coverDownloadedAt).toBeTruthy();
  });

  test('a cover the remote does not have costs one GET and saves nothing', async () => {
    const book = makeBook();
    const provider = makeProvider(makeIndex([book]), null);
    const saveBookCover = vi.fn(async (_book: Book, _bytes: ArrayBuffer) => {});
    const updateBookMetadata = vi.fn(async (_book: Book) => {});
    const store = makeStore({ saveBookCover, updateBookMetadata });

    const engine = new FileSyncEngine(provider, store);
    const result = await engine.syncLibrary([book], {
      strategy: 'silent',
      syncBooks: false,
      fullSync: true,
      deviceId: 'phone',
    });

    // The repair is one probe per cover-less row, not a retry loop, and a 404
    // must not write a row back (that would be a library write per book on
    // every Full Sync).
    const coverGets = (provider.readBinary as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).endsWith(COVER_PATH_SUFFIX),
    );
    expect(coverGets).toHaveLength(1);
    expect(saveBookCover).not.toHaveBeenCalled();
    expect(updateBookMetadata).not.toHaveBeenCalled();
    expect(result.coversDownloaded).toBe(0);
  });

  test('incremental sync leaves the repair to Full Sync', async () => {
    const book = makeBook();
    const provider = makeProvider(makeIndex([book]), new ArrayBuffer(64));
    const saveBookCover = vi.fn(async (_book: Book, _bytes: ArrayBuffer) => {});
    const store = makeStore({ saveBookCover });

    const engine = new FileSyncEngine(provider, store);
    const result = await engine.syncLibrary([book], {
      strategy: 'silent',
      syncBooks: false,
      fullSync: false,
      deviceId: 'phone',
    });

    // The default path is O(changed): a row whose clock matches the index is
    // untouched, so a placeholder cover waits for the user's Full Sync.
    const coverGets = (provider.readBinary as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => typeof call[0] === 'string' && (call[0] as string).endsWith(COVER_PATH_SUFFIX),
    );
    expect(coverGets).toHaveLength(0);
    expect(saveBookCover).not.toHaveBeenCalled();
    expect(result.coversDownloaded).toBe(0);
  });

  test('receive-only full sync repairs a missing local cover', async () => {
    const book = makeBook();
    const provider = makeProvider(makeIndex([book]), new ArrayBuffer(64));
    const saveBookCover = vi.fn(async (_book: Book, _bytes: ArrayBuffer) => {});
    const store = makeStore({ saveBookCover });

    const engine = new FileSyncEngine(provider, store);
    const result = await engine.syncLibrary([book], {
      strategy: 'receive',
      syncBooks: false,
      fullSync: true,
      deviceId: 'phone',
    });

    // Receive Only never enters the push pass, so the repair must not live
    // there: pull-only is exactly the mode a secondary device restores in.
    expect(saveBookCover).toHaveBeenCalledTimes(1);
    expect(result.coversDownloaded).toBe(1);
    expect(provider.writeBinary).not.toHaveBeenCalled();
  });

  test('send-only never pulls a cover down', async () => {
    const book = makeBook();
    const provider = makeProvider(makeIndex([book]), new ArrayBuffer(64));
    const saveBookCover = vi.fn(async (_book: Book, _bytes: ArrayBuffer) => {});
    const store = makeStore({ saveBookCover });

    const engine = new FileSyncEngine(provider, store);
    const result = await engine.syncLibrary([book], {
      strategy: 'send',
      syncBooks: false,
      fullSync: true,
      deviceId: 'phone',
    });

    expect(saveBookCover).not.toHaveBeenCalled();
    expect(result.coversDownloaded).toBe(0);
  });

  test('a book whose cover is already local is left alone', async () => {
    const book = makeBook();
    const localCover = new ArrayBuffer(64);
    const provider = makeProvider(makeIndex([book]), localCover);
    const saveBookCover = vi.fn(async (_book: Book, _bytes: ArrayBuffer) => {});
    const store = makeStore({
      loadBookCover: async () => ({ bytes: localCover, size: localCover.byteLength }),
      saveBookCover,
    });

    const engine = new FileSyncEngine(provider, store);
    const result = await engine.syncLibrary([book], {
      strategy: 'silent',
      syncBooks: false,
      fullSync: true,
      deviceId: 'phone',
    });

    // Same size as the remote copy: the existing HEAD short-circuit skips the
    // upload, and the repair must not fire either.
    expect(saveBookCover).not.toHaveBeenCalled();
    expect(result.coversDownloaded).toBe(0);
    expect(result.coversUploaded).toBe(0);
  });
});
