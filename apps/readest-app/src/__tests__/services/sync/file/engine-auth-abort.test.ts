import { beforeEach, describe, expect, test, vi } from 'vitest';

import type { Book, BookConfig } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import { FileSyncError, type FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * Terminal-failure semantics (the Drive web token expiry incident): an
 * unreadable index must not be treated as "no index yet" (which turns an
 * expired session into an attempted mass re-upload and would drop peers'
 * tombstones from the re-pushed index), and a mid-run AUTH_FAILED must stop
 * the per-book march instead of failing every remaining book identically.
 */

const makeBook = (hash: string): Book => ({
  hash,
  format: 'EPUB',
  title: `Book ${hash}`,
  sourceTitle: `Book ${hash}`,
  author: 'Author',
  createdAt: 1,
  updatedAt: 100,
});

const authError = () =>
  new FileSyncError('Google Drive session expired; reconnect in Settings', 'AUTH_FAILED', 401);

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
  deleteBookLocally: async () => {},
  ...overrides,
});

const baseProvider = (overrides: Partial<FileSyncProvider> = {}): FileSyncProvider => ({
  rootPath: '/',
  readText: vi.fn(async () => null),
  readBinary: vi.fn(async () => new ArrayBuffer(8)),
  head: vi.fn(async () => null),
  list: vi.fn(async () => []),
  writeText: vi.fn(async () => {}),
  writeBinary: vi.fn(async () => {}),
  ensureDir: vi.fn(async () => {}),
  deleteDir: vi.fn(async () => {}),
  ...overrides,
});

const syncOptions = { strategy: 'silent', syncBooks: false, deviceId: 'd1' } as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('FileSyncEngine terminal auth failures', () => {
  test('an unreadable index aborts the run before any push (expired session != first sync)', async () => {
    const provider = baseProvider({
      readText: vi.fn(async (path: string) => {
        if (path.endsWith('library.json')) throw authError();
        return null;
      }),
    });
    const engine = new FileSyncEngine(provider, makeStore());

    await expect(
      engine.syncLibrary([makeBook('h1'), makeBook('h2')], syncOptions),
    ).rejects.toMatchObject({ code: 'AUTH_FAILED' });

    expect(provider.writeText).not.toHaveBeenCalled();
    expect(provider.writeBinary).not.toHaveBeenCalled();
  });

  test('a mid-run AUTH_FAILED stops the march and skips the index re-push', async () => {
    const books = Array.from({ length: 50 }, (_, i) => makeBook(`h${i}`));
    const writeText = vi.fn(async (path: string) => {
      if (path.endsWith('config.json')) throw authError();
      // Recording an index write is the failure we care about below.
    });
    const provider = baseProvider({ writeText });
    const engine = new FileSyncEngine(provider, makeStore());

    await expect(engine.syncLibrary(books, syncOptions)).rejects.toMatchObject({
      code: 'AUTH_FAILED',
    });

    // The pool must stop scheduling once the session is known-dead: far
    // fewer attempts than the 50-book library (bounded by in-flight work).
    expect(writeText.mock.calls.length).toBeLessThanOrEqual(8);
    // No library.json write from a run that could not read or sync anything.
    const indexWrites = writeText.mock.calls.filter(([p]) => String(p).endsWith('library.json'));
    expect(indexWrites).toHaveLength(0);
  });

  test('non-auth per-book failures still do not abort the rest (one bad apple)', async () => {
    const books = Array.from({ length: 10 }, (_, i) => makeBook(`h${i}`));
    const capture: { index?: RemoteLibraryIndex } = {};
    const writeText = vi.fn(async (path: string, body: string) => {
      if (path.endsWith('config.json')) throw new FileSyncError('boom', 'NETWORK', 500);
      if (path.endsWith('library.json')) capture.index = JSON.parse(body) as RemoteLibraryIndex;
    });
    const provider = baseProvider({ writeText });
    const engine = new FileSyncEngine(provider, makeStore());

    const result = await engine.syncLibrary(books, syncOptions);

    expect(result.failures).toBe(10);
    // The run completed and the index was still re-pushed.
    expect(capture.index).toBeDefined();
  });

  test('an absent index (404 -> null) keeps first-sync semantics', async () => {
    const capture: { index?: RemoteLibraryIndex } = {};
    const writeText = vi.fn(async (path: string, body: string) => {
      if (path.endsWith('library.json')) capture.index = JSON.parse(body) as RemoteLibraryIndex;
    });
    const provider = baseProvider({ writeText });
    const engine = new FileSyncEngine(provider, makeStore());

    const result = await engine.syncLibrary([makeBook('h1')], syncOptions);

    expect(result.failures).toBe(0);
    expect(capture.index?.books.map((b) => b.hash)).toEqual(['h1']);
  });
});
