import { describe, expect, test } from 'vitest';

import type { Book } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * #5911 (book groups wiped by a clean install + WebDAV Full Sync) and #5912
 * (third-party sync loses book descriptions) are one defect: `groupId` /
 * `groupName` and `metadata` were resolved on the WHOLE-ROW `updatedAt` clock
 * with raw, clearing assignment.
 *
 * `updatedAt` is bumped by operations that have nothing to do with either —
 * `cloudService.uploadBook` stamps it on every UPLOAD, run as a queue by
 * `transferManager`, which is what produced the reporter's "19 records with
 * sequential updatedAt within ~8 seconds". A row that wins (or merely TIES)
 * that clock overwrote the peer's groups and metadata in the shared
 * `library.json`, and every other device then pulled the emptied row.
 *
 * The pull side used a strict `>` while the push side rebuilt the index from
 * the local rows unconditionally, so a tie did not mean "no opinion, keep
 * both" — it meant "local wins and the peer's data is destroyed".
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

const withDescription = (description: string) =>
  ({ title: 'T', author: 'A', description }) as Book['metadata'];

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

describe('FileSyncEngine.syncLibrary — group membership (#5911)', () => {
  test('an unstamped ungrouped local row does not erase the indexed group', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 800, groupId: 'g1', groupName: 'Sci-Fi' })],
      }),
      captured,
    });
    // The BOOX row, restored from a stale Readest Cloud record: same book, no
    // group, and a newer updatedAt only because its file was once uploaded.
    await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 900 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'boox', fullSync: true },
    );

    const published = pushedIndex(captured)?.books?.[0];
    expect(published?.groupId).toBe('g1');
    expect(published?.groupName).toBe('Sci-Fi');
  });

  test('the group is restored on the device that had lost it', async () => {
    const applied: Book[] = [];
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 800, groupId: 'g1', groupName: 'Sci-Fi' })],
      }),
    });
    await new FileSyncEngine(
      provider,
      fakeStore({
        updateBookMetadata: async (b) => {
          applied.push(b);
        },
      }),
    ).syncLibrary([makeBook('h1', { updatedAt: 900 })], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'boox',
    });

    expect(applied[0]?.groupId).toBe('g1');
    expect(applied[0]?.groupName).toBe('Sci-Fi');
  });

  test('a tie does not erase the indexed group', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 100, groupId: 'g1', groupName: 'Sci-Fi' })],
      }),
      captured,
    });
    await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'boox', fullSync: true },
    );

    expect(pushedIndex(captured)?.books?.[0]?.groupId).toBe('g1');
  });

  test('a STAMPED removal still propagates (the #4942 contract)', async () => {
    const applied: Book[] = [];
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 900, groupUpdatedAt: 900 })],
      }),
    });
    await new FileSyncEngine(
      provider,
      fakeStore({
        updateBookMetadata: async (b) => {
          applied.push(b);
        },
      }),
    ).syncLibrary(
      [makeBook('h1', { updatedAt: 100, groupId: 'g1', groupName: 'Sci-Fi', groupUpdatedAt: 100 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'pc' },
    );

    expect(applied[0]?.groupId).toBeUndefined();
    expect(applied[0]?.groupName).toBeUndefined();
  });

  test('a group edit that loses the row clock still reaches the index', async () => {
    // The upload-bump hazard in its purest form: this device grouped the book
    // at 300; the peer's row is at 9000 because its file was uploaded.
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 9_000 })],
      }),
      captured,
    });
    await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 300, groupId: 'g1', groupName: 'Sci-Fi', groupUpdatedAt: 300 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'pc', fullSync: true },
    );

    expect(pushedIndex(captured)?.books?.[0]?.groupId).toBe('g1');
  });
});

describe('FileSyncEngine.syncLibrary — book metadata (#5912)', () => {
  test('a metadata-less local row does not erase the indexed description', async () => {
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 100, metadata: withDescription('A long blurb') })],
      }),
      captured,
    });
    // A peer's row adopted from a Readest Cloud record whose `metadata` column
    // was null: same title and author, no metadata, newer row clock.
    await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 500 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'peer' },
    );

    expect(pushedIndex(captured)?.books?.[0]?.metadata?.description).toBe('A long blurb');
  });

  test('the description is restored on the device that had lost it', async () => {
    const applied: Book[] = [];
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [makeBook('h1', { updatedAt: 100, metadata: withDescription('A long blurb') })],
      }),
    });
    await new FileSyncEngine(
      provider,
      fakeStore({
        updateBookMetadata: async (b) => {
          applied.push(b);
        },
      }),
    ).syncLibrary([makeBook('h1', { updatedAt: 500 })], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'peer',
    });

    expect(applied[0]?.metadata?.description).toBe('A long blurb');
  });

  test('a real metadata edit still wins over an older description', async () => {
    const applied: Book[] = [];
    const provider = fakeProvider({
      readText: indexServing({
        schemaVersion: 1,
        updatedAt: 1,
        books: [
          makeBook('h1', {
            updatedAt: 900,
            metadata: withDescription('Edited blurb'),
            metadataUpdatedAt: 900,
          }),
        ],
      }),
    });
    await new FileSyncEngine(
      provider,
      fakeStore({
        updateBookMetadata: async (b) => {
          applied.push(b);
        },
      }),
    ).syncLibrary(
      [
        makeBook('h1', {
          updatedAt: 100,
          metadata: withDescription('Old blurb'),
          metadataUpdatedAt: 100,
        }),
      ],
      { strategy: 'silent', syncBooks: false, deviceId: 'peer' },
    );

    expect(applied[0]?.metadata?.description).toBe('Edited blurb');
  });
});

describe('FileSyncEngine.syncLibrary — no churn', () => {
  test('an already-converged library writes no index', async () => {
    const captured: Captured = { writes: [] };
    const row = makeBook('h1', {
      updatedAt: 100,
      groupId: 'g1',
      groupName: 'Sci-Fi',
      groupUpdatedAt: 100,
      metadata: withDescription('A long blurb'),
    });
    const provider = fakeProvider({
      readText: indexServing({ schemaVersion: 1, updatedAt: 1, books: [row] }),
      captured,
    });
    await new FileSyncEngine(provider, fakeStore()).syncLibrary([{ ...row }], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'pc',
    });

    expect(pushedIndex(captured)).toBeNull();
  });
});

describe('FileSyncEngine.syncLibrary — repair costs no downloads', () => {
  test('a group/description-only repair pulls neither cover nor config', async () => {
    // Nothing says the remote BYTES moved: no clock is newer, the index just
    // holds fields this device is missing. On a first run after the fix that
    // is true for a whole library at once, so it must stay free.
    const reads: string[] = [];
    const provider = fakeProvider({
      readText: async (p: string) => {
        reads.push(p);
        return p.endsWith('library.json')
          ? JSON.stringify({
              schemaVersion: 1,
              updatedAt: 1,
              books: [
                makeBook('h1', {
                  updatedAt: 100,
                  groupId: 'g1',
                  groupName: 'Sci-Fi',
                  metadata: withDescription('A long blurb'),
                }),
              ],
            })
          : null;
      },
      readBinary: async (p: string) => {
        reads.push(p);
        return new ArrayBuffer(8);
      },
    });
    const applied: Book[] = [];
    await new FileSyncEngine(
      provider,
      fakeStore({
        updateBookMetadata: async (b) => {
          applied.push(b);
        },
      }),
    ).syncLibrary([makeBook('h1', { updatedAt: 100 })], {
      strategy: 'silent',
      syncBooks: false,
      deviceId: 'peer',
    });

    expect(applied[0]?.groupId).toBe('g1');
    expect(applied[0]?.metadata?.description).toBe('A long blurb');
    expect(reads.filter((p) => p.endsWith('cover.png'))).toEqual([]);
    expect(reads.filter((p) => p.endsWith('config.json'))).toEqual([]);
  });

  test('a genuinely newer remote row still re-pulls the cover', async () => {
    const reads: string[] = [];
    const provider = fakeProvider({
      readText: async (p: string) => {
        reads.push(p);
        return p.endsWith('library.json')
          ? JSON.stringify({
              schemaVersion: 1,
              updatedAt: 1,
              books: [makeBook('h1', { updatedAt: 900, title: 'Renamed' })],
            })
          : null;
      },
      readBinary: async (p: string) => {
        reads.push(p);
        return new ArrayBuffer(8);
      },
    });
    await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'silent', syncBooks: false, deviceId: 'peer' },
    );

    expect(reads.some((p) => p.endsWith('cover.png'))).toBe(true);
  });
});
