import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { WebDAVSettings } from '@/types/settings';
import type { Book, BookConfig, BookNote } from '@/types/book';

/**
 * Regression tests for issue #4756: once a device already has a book in its
 * local library, the manual "Sync now" path never pulled the book's metadata
 * (title / author / cover) back from the shared `library.json`, and the final
 * index re-push clobbered the remote with the device's stale copy.
 *
 * These tests mock the WebDAVClient I/O primitives so we can drive
 * `syncLibrary` deterministically without a real server, and assert the
 * last-writer-wins reconciliation on `book.updatedAt`.
 */

vi.mock('@/services/webdav/WebDAVClient', async (importActual) => {
  const actual = await importActual<typeof import('@/services/webdav/WebDAVClient')>();
  return {
    ...actual,
    getFile: vi.fn(),
    getFileBinary: vi.fn(),
    headFile: vi.fn(),
    listDirectory: vi.fn(),
    putFile: vi.fn(),
    putFileBinary: vi.fn(),
    ensureDirectory: vi.fn(),
    deleteDirectory: vi.fn(),
  };
});

import {
  getFile,
  getFileBinary,
  headFile,
  listDirectory,
  putFile,
  putFileBinary,
  ensureDirectory,
} from '@/services/webdav/WebDAVClient';
import {
  syncLibrary,
  type RemoteLibraryIndex,
  type RemoteBookConfig,
} from '@/services/webdav/WebDAVSync';

const settings: WebDAVSettings = {
  enabled: true,
  serverUrl: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
  rootPath: '/',
};

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

/**
 * Route `getFile` by path: library.json → index JSON, config.json → the
 * supplied remote envelope (or null when none).
 */
const wireGetFile = (
  index: RemoteLibraryIndex | null,
  remoteConfig: RemoteBookConfig | null = null,
) => {
  (getFile as ReturnType<typeof vi.fn>).mockImplementation(async (_client, path: string) => {
    if (path.endsWith('library.json')) return index ? JSON.stringify(index) : null;
    if (path.endsWith('config.json')) return remoteConfig ? JSON.stringify(remoteConfig) : null;
    return null;
  });
};

/** Capture the library index that was re-pushed at the end of the sync. */
const capturePushedIndex = (): { value: RemoteLibraryIndex | null } => {
  const captured: { value: RemoteLibraryIndex | null } = { value: null };
  (putFile as ReturnType<typeof vi.fn>).mockImplementation(async (_client, path: string, body) => {
    if (path.endsWith('library.json')) captured.value = JSON.parse(body as string);
  });
  return captured;
};

/** Capture the per-book config envelope pushed to <hash>/config.json. */
const capturePushedConfig = (): { value: RemoteBookConfig | null } => {
  const captured: { value: RemoteBookConfig | null } = { value: null };
  (putFile as ReturnType<typeof vi.fn>).mockImplementation(async (_client, path: string, body) => {
    if (path.endsWith('config.json')) captured.value = JSON.parse(body as string);
  });
  return captured;
};

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

beforeEach(() => {
  vi.clearAllMocks();
  (listDirectory as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getFileBinary as ReturnType<typeof vi.fn>).mockResolvedValue(new ArrayBuffer(8));
  (headFile as ReturnType<typeof vi.fn>).mockResolvedValue(null);
  (putFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (putFileBinary as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
  (ensureDirectory as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const baseOptions = () => ({
  strategy: 'silent' as const,
  syncBooks: false,
  deviceId: 'pc-device',
  loadConfig: async (): Promise<BookConfig> => ({ updatedAt: 50, booknotes: [] }),
  loadBookFile: async () => null,
  loadBookCover: async () => null,
  onProgress: () => {},
});

describe('syncLibrary metadata reconciliation (#4756)', () => {
  test('pulls newer remote metadata for a book the device already has', async () => {
    const local = makeLocalBook({ updatedAt: 100 });
    const remote = makeLocalBook({
      title: 'New Title',
      author: 'New Author',
      updatedAt: 200,
    });
    wireGetFile(makeRemoteIndex(remote, 200));
    const pushedIndex = capturePushedIndex();

    const updateBookMetadata = vi.fn(async (_book: Book) => {});
    const saveBookCover = vi.fn(async (_book: Book, _bytes: ArrayBuffer) => {});

    const result = await syncLibrary(settings, [local], {
      ...baseOptions(),
      updateBookMetadata,
      saveBookCover,
    });

    // The device must learn the remote title/author.
    expect(updateBookMetadata).toHaveBeenCalledTimes(1);
    const merged = updateBookMetadata.mock.calls[0]![0];
    expect(merged.title).toBe('New Title');
    expect(merged.author).toBe('New Author');
    expect(result.metadataUpdated).toBe(1);

    // The cover must be re-pulled so a changed cover propagates.
    expect(saveBookCover).toHaveBeenCalledTimes(1);

    // The re-pushed index must carry the newer metadata, not clobber it.
    expect(pushedIndex.value).not.toBeNull();
    const indexedBook = pushedIndex.value!.books.find((b) => b.hash === 'h1')!;
    expect(indexedBook.title).toBe('New Title');
  });

  test('does not overwrite local metadata when the local copy is newer', async () => {
    const local = makeLocalBook({ title: 'Local Newer', updatedAt: 300 });
    const remote = makeLocalBook({ title: 'Remote Older', updatedAt: 200 });
    wireGetFile(makeRemoteIndex(remote, 200));
    const pushedIndex = capturePushedIndex();

    const updateBookMetadata = vi.fn(async (_book: Book) => {});

    const result = await syncLibrary(settings, [local], {
      ...baseOptions(),
      updateBookMetadata,
    });

    expect(updateBookMetadata).not.toHaveBeenCalled();
    expect(result.metadataUpdated).toBe(0);

    // Local wins: the re-pushed index keeps the local title.
    const indexedBook = pushedIndex.value!.books.find((b) => b.hash === 'h1')!;
    expect(indexedBook.title).toBe('Local Newer');
  });
});

describe('syncLibrary config merge before push (Sync now must not blind-overwrite)', () => {
  test('unions remote booknotes into the pushed config instead of clobbering them', async () => {
    const local = makeLocalBook({ updatedAt: 100 });
    // Same updatedAt in the index so the metadata pass is a no-op — this
    // isolates the config/notes path.
    wireGetFile(
      makeRemoteIndex(makeLocalBook({ updatedAt: 100 }), 100),
      makeRemoteConfig({ config: { updatedAt: 100 }, booknotes: [makeNote('remote-note', 100)] }),
    );
    const pushedConfig = capturePushedConfig();

    await syncLibrary(settings, [local], {
      ...baseOptions(),
      loadConfig: async (): Promise<BookConfig> => ({
        updatedAt: 50,
        booknotes: [makeNote('local-note', 50)],
      }),
    });

    // The pushed envelope must carry BOTH notes — a blind push would have
    // dropped the peer's note that this device never pulled.
    expect(pushedConfig.value).not.toBeNull();
    const ids = pushedConfig.value!.booknotes.map((n) => n.id).sort();
    expect(ids).toEqual(['local-note', 'remote-note']);
  });

  test('does not regress newer remote progress with an older local push', async () => {
    const local = makeLocalBook({ updatedAt: 100 });
    wireGetFile(
      makeRemoteIndex(makeLocalBook({ updatedAt: 100 }), 100),
      makeRemoteConfig({ config: { updatedAt: 200, progress: [50, 100] }, booknotes: [] }),
    );
    const pushedConfig = capturePushedConfig();

    await syncLibrary(settings, [local], {
      ...baseOptions(),
      loadConfig: async (): Promise<BookConfig> => ({
        updatedAt: 50,
        progress: [10, 100],
        booknotes: [],
      }),
    });

    // Remote progress is newer (updatedAt 200 > 50): the LWW merge must push
    // the remote's page, never regress it back to the local page.
    expect(pushedConfig.value!.config.progress).toEqual([50, 100]);
  });

  test('send strategy keeps the blind push (local authoritative, no pull-merge)', async () => {
    const local = makeLocalBook({ updatedAt: 100 });
    wireGetFile(
      null,
      makeRemoteConfig({ config: { updatedAt: 200 }, booknotes: [makeNote('remote-note', 200)] }),
    );
    const pushedConfig = capturePushedConfig();

    await syncLibrary(settings, [local], {
      ...baseOptions(),
      strategy: 'send',
      loadConfig: async (): Promise<BookConfig> => ({
        updatedAt: 50,
        booknotes: [makeNote('local-note', 50)],
      }),
    });

    // 'send' deliberately treats local as the source of truth — it must not
    // pull the remote note in.
    const ids = pushedConfig.value!.booknotes.map((n) => n.id);
    expect(ids).toEqual(['local-note']);
  });
});
