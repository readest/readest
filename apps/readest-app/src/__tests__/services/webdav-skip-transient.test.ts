import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { syncLibrary } from '@/services/webdav/WebDAVSync';
import type { WebDAVSettings } from '@/types/settings';
import type { Book, BookConfig } from '@/types/book';

/**
 * `syncLibrary` must never upload anything for a transient import — those
 * Books carry both `filePath` (source URI outside Books/<hash>/) and
 * `deletedAt` (set at creation time by `bookService.importBook` when
 * `transient: true`). Pushing config.json under `Readest/books/<hash>/`
 * for such a hash creates a per-hash directory on the remote, which the
 * directory-listing fallback in `syncLibrary` then materialises as a
 * phantom shelf row on every sibling device's next sync.
 *
 * These tests exercise the library-wide push gate in isolation: we pass
 * a tiny `books` array containing one transient and one normal entry,
 * stub all network primitives, and assert that exactly the non-transient
 * book ends up on the wire.
 */

const ORIGINAL_FETCH = globalThis.fetch;

const settings: WebDAVSettings = {
  enabled: true,
  serverUrl: 'https://dav.example.com',
  username: 'alice',
  password: 'secret',
  rootPath: '/',
};

const makeBook = (overrides: Partial<Book>): Book => ({
  hash: 'h0',
  format: 'EPUB',
  title: 'Untitled',
  author: 'Unknown',
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

const emptyConfig = (): BookConfig => ({ updatedAt: 0, booknotes: [] });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  // Default: every call is a benign 404 (nothing on the remote yet).
  // Individual tests can override per call via `mockImplementation`.
  fetchMock.mockResolvedValue(new Response(null, { status: 404 }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  vi.restoreAllMocks();
});

describe('syncLibrary transient guard', () => {
  test('skips books that have both filePath and deletedAt set', async () => {
    const transient = makeBook({
      hash: 'transient-hash',
      filePath: 'content://shared/file.epub',
      deletedAt: Date.now(),
    });
    const normal = makeBook({ hash: 'normal-hash' });

    const loadConfig = vi.fn<(book: Book) => Promise<BookConfig>>(async () => emptyConfig());
    const loadBookFile = vi.fn(async () => null);

    await syncLibrary(settings, [transient, normal], {
      strategy: 'send', // push-only path keeps the assertion focused
      syncBooks: false,
      deviceId: 'device-A',
      loadConfig,
      loadBookFile,
    });

    // `loadConfig` is the first per-book step in the push loop, so it's
    // a clean signal for "did this book reach the upload pipeline?"
    const configCalls = loadConfig.mock.calls.map(([book]) => book.hash);
    expect(configCalls).toContain('normal-hash');
    expect(configCalls).not.toContain('transient-hash');

    // No PUT to `Readest/books/transient-hash/...` should ever fire.
    const transientPuts = fetchMock.mock.calls.filter((call) => {
      const [url, init] = call as [string, RequestInit | undefined];
      return (init?.method ?? '').toUpperCase() === 'PUT' && url.includes('transient-hash');
    });
    expect(transientPuts).toHaveLength(0);
  });

  test('still skips when only deletedAt is set (regular tombstone)', async () => {
    // Pre-existing behaviour we must not regress: a book the user
    // explicitly deleted carries `deletedAt` but typically no
    // `filePath`. The deletedAt filter alone keeps it off the wire,
    // independent of the new transient guard.
    const tombstoned = makeBook({ hash: 'tomb-hash', deletedAt: Date.now() });

    const loadConfig = vi.fn(async () => emptyConfig());
    const loadBookFile = vi.fn(async () => null);

    await syncLibrary(settings, [tombstoned], {
      strategy: 'send',
      syncBooks: false,
      deviceId: 'device-A',
      loadConfig,
      loadBookFile,
    });

    expect(loadConfig).not.toHaveBeenCalled();
  });

  test('does NOT skip in-place imports (filePath set but deletedAt null)', async () => {
    // In-place imports also populate `book.filePath`, but they're
    // first-class library entries (`deletedAt: null`). They MUST sync
    // — the inline comments in `bookService.importBook` and the
    // ingestService upload logic both treat them as normal books.
    const inPlace = makeBook({
      hash: 'inplace-hash',
      filePath: '/Users/alice/MyLibrary/book.epub',
      deletedAt: null,
    });

    // Make MKCOL / PUT succeed so the push pipeline runs end-to-end
    // without spamming the test log with simulated 404 stack traces.
    fetchMock.mockImplementation(async (_url, init) => {
      const method = ((init as RequestInit | undefined)?.method ?? 'GET').toUpperCase();
      if (method === 'MKCOL' || method === 'PUT') return new Response(null, { status: 201 });
      return new Response(null, { status: 404 });
    });

    const loadConfig = vi.fn(async () => emptyConfig());
    const loadBookFile = vi.fn(async () => null);

    await syncLibrary(settings, [inPlace], {
      strategy: 'send',
      syncBooks: false,
      deviceId: 'device-A',
      loadConfig,
      loadBookFile,
    });

    expect(loadConfig).toHaveBeenCalledWith(expect.objectContaining({ hash: 'inplace-hash' }));
  });
});
