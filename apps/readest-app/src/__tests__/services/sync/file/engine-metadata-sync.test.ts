import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book, BookConfig, BookNote } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteBookConfig, RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * Behavior-preservation gate for the WebDAV→FileSyncEngine port (originally
 * webdav-metadata-sync.test.ts for issue #4756). Instead of mocking the
 * WebDAV transport client, we drive `FileSyncEngine` with a fake
 * `FileSyncProvider` (routed by path) and a fake `LocalStore`, asserting the
 * same last-writer-wins reconciliation on `book.updatedAt` and the same
 * pull-merge-before-push discipline.
 */

const makeLocalBook = (overrides: Partial<Book> = {}): Book => ({
  hash: 'h1',
  format: 'EPUB',
  title: 'Old Title',
  sourceTitle: 'Old Title',
  author: 'Old Author',
  createdAt: 1,
  updatedAt: 100,
  ...overrides,
});

const makeRemoteIndex = (book: Book, updatedAt = book.updatedAt): RemoteLibraryIndex => ({
  schemaVersion: 1,
  updatedAt,
  books: [book],
});

const makeNote = (id: string, updatedAt: number): BookNote => ({
  id,
  type: 'annotation',
  cfi: `cfi-${id}`,
  note: '',
  createdAt: updatedAt,
  updatedAt,
});

const makeRemoteConfig = (overrides: Partial<RemoteBookConfig> = {}): RemoteBookConfig => ({
  schemaVersion: 1,
  bookHash: 'h1',
  config: { updatedAt: 100 },
  booknotes: [],
  writerDeviceId: 'mobile',
  writerVersion: 'readest-webdav-1',
  updatedAt: 100,
  ...overrides,
});

/**
 * A fake provider routed by path: readText resolves the index for
 * library.json and the supplied envelope for config.json. writeText captures
 * whichever artefact a test cares about. No streaming methods, so the engine
 * uses the buffered path (and the store's null loaders skip uploads).
 */
const makeProvider = (
  index: RemoteLibraryIndex | null,
  remoteConfig: RemoteBookConfig | null,
  capture: { index?: RemoteLibraryIndex | null; config?: RemoteBookConfig | null },
): FileSyncProvider => ({
  rootPath: '/',
  readText: vi.fn(async (path: string) => {
    if (path.endsWith('library.json')) return index ? JSON.stringify(index) : null;
    if (path.endsWith('config.json')) return remoteConfig ? JSON.stringify(remoteConfig) : null;
    return null;
  }),
  readBinary: vi.fn(async () => new ArrayBuffer(8)),
  head: vi.fn(async () => null),
  list: vi.fn(async () => []),
  writeText: vi.fn(async (path: string, body: string) => {
    if (path.endsWith('library.json')) capture.index = JSON.parse(body) as RemoteLibraryIndex;
    if (path.endsWith('config.json')) capture.config = JSON.parse(body) as RemoteBookConfig;
  }),
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
  loadBookCover: async () => null,
  saveBookCover: async () => {},
  addBookToLibrary: async () => {},
  updateBookMetadata: async () => {},
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('FileSyncEngine metadata reconciliation (#4756)', () => {
  test('pulls newer remote metadata for a book the device already has', async () => {
    const local = makeLocalBook({ updatedAt: 100 });
    const remote = makeLocalBook({ title: 'New Title', author: 'New Author', updatedAt: 200 });
    const capture: { index?: RemoteLibraryIndex | null } = {};
    const provider = makeProvider(makeRemoteIndex(remote, 200), null, capture);

    const updateBookMetadata = vi.fn(async (_book: Book) => {});
    const saveBookCover = vi.fn(async (_book: Book, _bytes: ArrayBuffer) => {});
    const store = makeStore({ updateBookMetadata, saveBookCover });

    const engine = new FileSyncEngine(provider, store);
    const result = await engine.syncLibrary([local], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'pc-device',
    });

    expect(updateBookMetadata).toHaveBeenCalledTimes(1);
    const merged = updateBookMetadata.mock.calls[0]![0];
    expect(merged.title).toBe('New Title');
    expect(merged.author).toBe('New Author');
    expect(result.metadataUpdated).toBe(1);
    expect(saveBookCover).toHaveBeenCalledTimes(1);

    expect(capture.index).not.toBeNull();
    const indexedBook = capture.index!.books.find((b) => b.hash === 'h1')!;
    expect(indexedBook.title).toBe('New Title');
  });

  test('does not overwrite local metadata when the local copy is newer', async () => {
    const local = makeLocalBook({ title: 'Local Newer', updatedAt: 300 });
    const remote = makeLocalBook({ title: 'Remote Older', updatedAt: 200 });
    const capture: { index?: RemoteLibraryIndex | null } = {};
    const provider = makeProvider(makeRemoteIndex(remote, 200), null, capture);

    const updateBookMetadata = vi.fn(async (_book: Book) => {});
    const store = makeStore({ updateBookMetadata });

    const engine = new FileSyncEngine(provider, store);
    const result = await engine.syncLibrary([local], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'pc-device',
    });

    expect(updateBookMetadata).not.toHaveBeenCalled();
    expect(result.metadataUpdated).toBe(0);
    const indexedBook = capture.index!.books.find((b) => b.hash === 'h1')!;
    expect(indexedBook.title).toBe('Local Newer');
  });
});

describe('FileSyncEngine config merge before push (Sync now must not blind-overwrite)', () => {
  test('unions remote booknotes into the pushed config instead of clobbering them', async () => {
    const local = makeLocalBook({ updatedAt: 100 });
    const capture: { config?: RemoteBookConfig | null } = {};
    const provider = makeProvider(
      makeRemoteIndex(makeLocalBook({ updatedAt: 100 }), 100),
      makeRemoteConfig({ config: { updatedAt: 100 }, booknotes: [makeNote('remote-note', 100)] }),
      capture,
    );
    const store = makeStore({
      loadConfig: async (): Promise<BookConfig> => ({
        updatedAt: 50,
        booknotes: [makeNote('local-note', 50)],
      }),
    });

    const engine = new FileSyncEngine(provider, store);
    await engine.syncLibrary([local], { strategy: 'silent', syncBooks: false, deviceId: 'pc' });

    expect(capture.config).not.toBeNull();
    const ids = capture.config!.booknotes.map((n) => n.id).sort();
    expect(ids).toEqual(['local-note', 'remote-note']);
  });

  test('does not regress newer remote progress with an older local push', async () => {
    const local = makeLocalBook({ updatedAt: 100 });
    const capture: { config?: RemoteBookConfig | null } = {};
    const provider = makeProvider(
      makeRemoteIndex(makeLocalBook({ updatedAt: 100 }), 100),
      makeRemoteConfig({ config: { updatedAt: 200, progress: [50, 100] }, booknotes: [] }),
      capture,
    );
    const store = makeStore({
      loadConfig: async (): Promise<BookConfig> => ({
        updatedAt: 50,
        progress: [10, 100],
        booknotes: [],
      }),
    });

    const engine = new FileSyncEngine(provider, store);
    await engine.syncLibrary([local], { strategy: 'silent', syncBooks: false, deviceId: 'pc' });

    expect(capture.config!.config.progress).toEqual([50, 100]);
  });

  test('send strategy keeps the blind push (local authoritative, no pull-merge)', async () => {
    const local = makeLocalBook({ updatedAt: 100 });
    const capture: { config?: RemoteBookConfig | null } = {};
    const provider = makeProvider(
      null,
      makeRemoteConfig({ config: { updatedAt: 200 }, booknotes: [makeNote('remote-note', 200)] }),
      capture,
    );
    const store = makeStore({
      loadConfig: async (): Promise<BookConfig> => ({
        updatedAt: 50,
        booknotes: [makeNote('local-note', 50)],
      }),
    });

    const engine = new FileSyncEngine(provider, store);
    await engine.syncLibrary([local], { strategy: 'send', syncBooks: false, deviceId: 'pc' });

    const ids = capture.config!.booknotes.map((n) => n.id);
    expect(ids).toEqual(['local-note']);
  });
});
