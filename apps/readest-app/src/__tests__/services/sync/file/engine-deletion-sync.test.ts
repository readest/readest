import { describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * #4860: WebDAV deletions must propagate. Three behaviours are exercised here:
 *   1. a peer's tombstone deletes the book locally (edit-wins-over-delete guard),
 *   2. the deleted book's remote hash directory is GC'd off the server,
 *   3. a tombstone for a book this device never had survives the index re-push
 *      (otherwise the deletion would silently vanish from library.json).
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

type Captured = { writes: { path: string; body: string }[]; deletedDirs: string[] };

const fakeProvider = (
  opts: Partial<FileSyncProvider> & { captured?: Captured } = {},
): FileSyncProvider => ({
  rootPath: '/',
  readText: opts.readText ?? (async () => null),
  readBinary: opts.readBinary ?? (async () => null),
  head: opts.head ?? (async () => null),
  list: opts.list ?? (async () => []),
  writeText:
    opts.writeText ??
    (async (path: string, body: string) => {
      opts.captured?.writes.push({ path, body });
    }),
  writeBinary: opts.writeBinary ?? (async () => {}),
  ensureDir: opts.ensureDir ?? (async () => {}),
  deleteDir:
    opts.deleteDir ??
    (async (path: string) => {
      opts.captured?.deletedDirs.push(path);
    }),
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

const makeIndex = (books: Book[]): RemoteLibraryIndex => ({
  schemaVersion: 1,
  updatedAt: 1,
  books,
});

const libraryWrite = (captured: Captured) =>
  captured.writes.find((w) => w.path.endsWith('library.json'));

describe('FileSyncEngine.syncLibrary — deletion propagation (#4860)', () => {
  test('deletes a book locally when a peer tombstoned it', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100, deletedAt: 200 })]))
          : null,
      captured,
    });
    const deleteBookLocally = vi.fn<(b: Book) => Promise<void>>(async () => {});
    const store = fakeStore({ deleteBookLocally });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'd' },
    );

    expect(deleteBookLocally).toHaveBeenCalledTimes(1);
    expect(deleteBookLocally.mock.calls[0]![0].hash).toBe('h1');
    expect(deleteBookLocally.mock.calls[0]![0].deletedAt).toBe(200);
    expect(res.booksDeleted).toBe(1);

    // The tombstone must be carried into the re-pushed index.
    const idx = libraryWrite(captured);
    expect(idx).toBeDefined();
    const parsed = JSON.parse(idx!.body) as RemoteLibraryIndex;
    const h1 = parsed.books.find((b) => b.hash === 'h1');
    expect(h1?.deletedAt).toBe(200);
  });

  test('does not re-push the config of a book it just peer-deleted', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 100, deletedAt: 200 })]))
          : p.endsWith('config.json')
            ? JSON.stringify({ schemaVersion: 1, bookHash: 'h1', config: {}, booknotes: [] })
            : null,
      captured,
    });
    // The book file is still on disk after a 'local' delete removes the copy, so
    // loadConfig returns a real config — the push loop must still skip it.
    const store = fakeStore({
      loadConfig: async () => ({ updatedAt: 1, booknotes: [] }),
      loadBookFile: async () => ({ bytes: new ArrayBuffer(8), size: 8 }),
    });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: true, deviceId: 'd' },
    );

    expect(res.booksDeleted).toBe(1);
    expect(res.configsUploaded).toBe(0);
    expect(res.filesUploaded).toBe(0);
    expect(captured.writes.filter((w) => w.path.endsWith('config.json'))).toHaveLength(0);
  });

  test('does not delete locally when the local copy was edited after the deletion', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(makeIndex([makeBook('h1', { updatedAt: 50, deletedAt: 100 })]))
          : null,
      captured,
    });
    const deleteBookLocally = vi.fn<(b: Book) => Promise<void>>(async () => {});
    const store = fakeStore({ deleteBookLocally });

    const res = await new FileSyncEngine(provider, store).syncLibrary(
      // Local edit (updatedAt 200) is newer than the remote deletion (100).
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'd' },
    );

    expect(deleteBookLocally).not.toHaveBeenCalled();
    expect(res.booksDeleted).toBe(0);
  });

  test('GCs the remote hash directory of a locally-deleted book', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async () => null, // fresh remote index
      list: async (path: string) =>
        path.endsWith('/books')
          ? [{ name: 'h1', path: '/Readest/books/h1', isDirectory: true }]
          : [],
      captured,
    });
    const store = fakeStore();

    await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, deletedAt: 100 })],
      { strategy: 'silent', syncBooks: true, deviceId: 'd' },
    );

    expect(captured.deletedDirs).toContain('/Readest/books/h1');
  });

  test('does not GC a hash dir that is no longer on the server', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async () => null,
      list: async () => [], // the books dir is empty — nothing to GC
      captured,
    });
    const store = fakeStore();

    await new FileSyncEngine(provider, store).syncLibrary(
      [makeBook('h1', { updatedAt: 100, deletedAt: 100 })],
      { strategy: 'silent', syncBooks: true, deviceId: 'd' },
    );

    expect(captured.deletedDirs).toHaveLength(0);
  });

  test('preserves a remote tombstone for a book this device never had', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(
              makeIndex([
                makeBook('h1', { updatedAt: 100 }),
                makeBook('h2', { updatedAt: 100, deletedAt: 300 }),
              ]),
            )
          : null,
      captured,
    });
    const store = fakeStore();

    // Local library only has h1; it has never seen h2. h1 is locally newer so
    // the run is dirty and the index gets re-pushed — the union must carry
    // h2's tombstone even though this device never materialised the book.
    await new FileSyncEngine(provider, store).syncLibrary([makeBook('h1', { updatedAt: 200 })], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'd',
    });

    const idx = libraryWrite(captured);
    expect(idx).toBeDefined();
    const parsed = JSON.parse(idx!.body) as RemoteLibraryIndex;
    const h2 = parsed.books.find((b) => b.hash === 'h2');
    expect(h2?.deletedAt).toBe(300);
  });
});
