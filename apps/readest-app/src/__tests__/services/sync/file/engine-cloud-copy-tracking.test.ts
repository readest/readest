import { describe, expect, test, vi } from 'vitest';

import type { Book } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

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
  markBooksUploaded: opts.markBooksUploaded ?? (async () => {}),
});

const makeIndex = (books: Book[]): RemoteLibraryIndex => ({
  schemaVersion: 1,
  updatedAt: 1,
  books,
});

const libraryWrite = (captured: Captured) =>
  captured.writes.find((w) => w.path.endsWith('library.json'));

const indexedBooks = (captured: Captured): Book[] =>
  (JSON.parse(libraryWrite(captured)!.body) as RemoteLibraryIndex).books;

/**
 * #5084: "Remove from Device Only" must leave the book on the remote.
 *
 * The device-local `filePath` (an absolute path from an in-place / transient
 * import) is meaningless on any other device. Leaking it through library.json
 * makes peers adopt a path that cannot exist for them, and the app reads
 * `book.filePath` as "this is a purely-local book" — so a peer whose file is
 * absent treats the row as a stale local record and offers to delete it, which
 * runs the cloud-and-device delete and GCs the book off Google Drive.
 * `useBooksSync.getNewBooks` already strips it for the native channel.
 */
describe('FileSyncEngine — device-local fields must not cross devices (#5084)', () => {
  test('the pushed library.json index does not carry filePath', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({ captured });
    const local = makeBook('h1', {
      updatedAt: 200,
      downloadedAt: 100,
      filePath: 'C:\\Users\\reader\\Books\\Book h1.epub',
    });

    await new FileSyncEngine(provider, fakeStore()).syncLibrary([local], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'dev-1',
    });

    const pushed = indexedBooks(captured).find((b) => b.hash === 'h1')!;
    expect(pushed.filePath).toBeUndefined();
  });

  test('a peer never adopts a remote row filePath when adding the book locally', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    // The remote index was pushed by a device that imported the book in place.
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify(
              makeIndex([
                makeBook('h1', {
                  updatedAt: 100,
                  filePath: 'C:\\Users\\reader\\Books\\Book h1.epub',
                }),
              ]),
            )
          : null,
      readBinary: async () => new ArrayBuffer(8),
      list: async (p: string) => {
        if (p.endsWith('/books')) return [{ name: 'h1', path: '/books/h1', isDirectory: true }];
        if (p.endsWith('/books/h1'))
          return [{ name: 'Book h1.epub', path: '/books/h1/Book h1.epub', isDirectory: false }];
        return [];
      },
      captured,
    });
    const addBookToLibrary = vi.fn<(b: Book) => Promise<void>>(async () => {});
    const store = fakeStore({ addBookToLibrary });

    await new FileSyncEngine(provider, store).syncLibrary([], {
      strategy: 'silent',
      syncBooks: true,
      deviceId: 'dev-2',
    });

    expect(addBookToLibrary).toHaveBeenCalledTimes(1);
    expect(addBookToLibrary.mock.calls[0]![0]!.filePath).toBeUndefined();
  });
});

/**
 * #5084: `book.uploadedAt` is the only signal the app has for "this book's file
 * is in the cloud". The engine never set it, so a provider-synced book was read
 * everywhere as purely-local — it could not be re-downloaded after a local
 * delete, and the stale-record cleanup offered to delete it, which GC'd the file
 * off the remote. Stamp it whenever the file is confirmed on the remote.
 */
describe('FileSyncEngine — stamps uploadedAt for provider-synced books (#5084)', () => {
  test('stamps a book whose file this run uploaded', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({ captured });
    const markBooksUploaded = vi.fn<(h: string[], at: number) => Promise<void>>(async () => {});
    const store = fakeStore({
      markBooksUploaded,
      loadBookFile: async () => ({ bytes: new ArrayBuffer(4), size: 4 }),
    });
    const local = makeBook('h1', { updatedAt: 200, downloadedAt: 100 });

    await new FileSyncEngine(provider, store).syncLibrary([local], {
      strategy: 'silent',
      syncBooks: true,
      deviceId: 'dev-1',
    });

    expect(markBooksUploaded).toHaveBeenCalledTimes(1);
    expect(markBooksUploaded.mock.calls[0]![0]).toEqual(['h1']);
    expect(indexedBooks(captured).find((b) => b.hash === 'h1')!.uploadedAt).toBeTruthy();
  });

  test('stamps a book the index already records as on the remote', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    // Another device uploaded the file; this device only holds the row.
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify({
              ...makeIndex([makeBook('h1', { updatedAt: 100 })]),
              uploadedHashes: ['h1'],
            })
          : null,
      captured,
    });
    const markBooksUploaded = vi.fn<(h: string[], at: number) => Promise<void>>(async () => {});
    const store = fakeStore({ markBooksUploaded });
    const local = makeBook('h1', { updatedAt: 100, downloadedAt: 50 });

    await new FileSyncEngine(provider, store).syncLibrary([local], {
      strategy: 'silent',
      // Even with book-file upload off: the file is already there.
      syncBooks: false,
      deviceId: 'dev-1',
    });

    expect(markBooksUploaded).toHaveBeenCalledTimes(1);
    expect(markBooksUploaded.mock.calls[0]![0]).toEqual(['h1']);
  });

  test('does not stamp a book whose file is on no remote', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({ captured });
    const markBooksUploaded = vi.fn<(h: string[], at: number) => Promise<void>>(async () => {});
    // loadBookFile/resolveLocalBookPath both return null => 'no-source'.
    const store = fakeStore({ markBooksUploaded });
    const local = makeBook('h1', { updatedAt: 200, downloadedAt: 100 });

    await new FileSyncEngine(provider, store).syncLibrary([local], {
      strategy: 'silent',
      syncBooks: true,
      deviceId: 'dev-1',
    });

    expect(markBooksUploaded).not.toHaveBeenCalled();
    expect(indexedBooks(captured).find((b) => b.hash === 'h1')!.uploadedAt).toBeFalsy();
  });

  test('a device-only delete leaves the book on the remote and keeps it re-downloadable', async () => {
    const captured: Captured = { writes: [], deletedDirs: [] };
    const provider = fakeProvider({
      readText: async (p) =>
        p.endsWith('library.json')
          ? JSON.stringify({
              ...makeIndex([makeBook('h1', { updatedAt: 100 })]),
              uploadedHashes: ['h1'],
            })
          : null,
      list: async (p: string) => {
        if (p.endsWith('/books')) return [{ name: 'h1', path: '/books/h1', isDirectory: true }];
        if (p.endsWith('/books/h1'))
          return [{ name: 'Book h1.epub', path: '/books/h1/Book h1.epub', isDirectory: false }];
        return [];
      },
      captured,
    });
    const markBooksUploaded = vi.fn<(h: string[], at: number) => Promise<void>>(async () => {});
    const store = fakeStore({ markBooksUploaded });
    // The row right after "Remove from Device Only": no local file, no tombstone.
    const local = makeBook('h1', { updatedAt: 200, downloadedAt: null });

    await new FileSyncEngine(provider, store).syncLibrary([local], {
      strategy: 'silent',
      syncBooks: true,
      deviceId: 'dev-1',
    });

    // The remote copy survives...
    expect(captured.deletedDirs).toEqual([]);
    // ...and the row is marked cloud-backed, so the app offers Download instead
    // of reading it as a local book whose file vanished.
    expect(markBooksUploaded.mock.calls[0]![0]).toEqual(['h1']);
  });
});
