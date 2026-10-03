import { describe, expect, test } from 'vitest';

import type { Book } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import type { FileSyncProvider } from '@/services/sync/file/provider';
import type { LocalStore } from '@/services/sync/file/localStore';
import type { RemoteLibraryIndex } from '@/services/sync/file/wire';

/**
 * Regression coverage for #5900: a "Send Only" (strategy 'send') run never
 * read the remote library.json index before rewriting it, so its final
 * re-push carried only this device's own `uploadedHashes` / book set and
 * silently dropped every previously-confirmed upload and every book entry
 * another device had contributed that this device doesn't locally know
 * about — exactly the "uploadedHashes shrinks" and "peer's live book goes
 * missing" symptoms reported against multi-device WebDAV Full Sync.
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

describe('FileSyncEngine.syncLibrary — Send Only index safety (#5900)', () => {
  test('carries forward the remote uploadedHashes record and a peer-only book', async () => {
    // The shared index already records two confirmed uploads (h1, h2), but
    // this device only knows about h1 locally — h2 was uploaded by a peer.
    const remoteIndex: RemoteLibraryIndex = {
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1'), makeBook('h2')],
      uploadedHashes: ['h1', 'h2'],
    };
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) => (p.endsWith('library.json') ? JSON.stringify(remoteIndex) : null),
      captured,
    });

    const res = await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 200 })],
      { strategy: 'send', syncBooks: false, deviceId: 'pc' },
    );

    // 'send' still blindly pushes the local book's config (unaffected).
    expect(res.configsUploaded).toBe(1);

    const idx = JSON.parse(
      captured.writes.find((w) => w.path.endsWith('library.json'))!.body,
    ) as RemoteLibraryIndex;
    // Before the fix, `uploadedHashes` was rebuilt from scratch (empty, since
    // send mode never pulled the index) and h2 — a book only a peer had
    // pushed — disappeared from the index entirely.
    expect(idx.uploadedHashes).toEqual(expect.arrayContaining(['h1', 'h2']));
    expect(idx.books.map((b) => b.hash).sort()).toEqual(['h1', 'h2']);
  });

  test('a Full Sync send still pushes over a newer remote row', async () => {
    // Remote has a newer copy of h1 than local. The incremental cursor skips
    // that push for every strategy (#5900: a 'send' run that re-pushed every
    // book was O(library) per sync). Blind local-authoritative overwrite is
    // what `fullSync` is for, so that is where this invariant now lives.
    const remoteIndex: RemoteLibraryIndex = {
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1', { updatedAt: 500, title: 'Remote Title' })],
      uploadedHashes: ['h1'],
    };
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) => (p.endsWith('library.json') ? JSON.stringify(remoteIndex) : null),
      captured,
    });

    const res = await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'send', syncBooks: false, fullSync: true, deviceId: 'pc' },
    );

    expect(res.configsUploaded).toBe(1);
    expect(captured.writes.some((w) => w.path.endsWith('config.json'))).toBe(true);
  });

  test('an incremental send skips a book the index already has at the same version', async () => {
    const remoteIndex: RemoteLibraryIndex = {
      schemaVersion: 1,
      updatedAt: 1,
      books: [makeBook('h1', { updatedAt: 500 })],
      uploadedHashes: ['h1'],
    };
    const captured: Captured = { writes: [] };
    const provider = fakeProvider({
      readText: async (p) => (p.endsWith('library.json') ? JSON.stringify(remoteIndex) : null),
      captured,
    });

    const res = await new FileSyncEngine(provider, fakeStore()).syncLibrary(
      [makeBook('h1', { updatedAt: 100 })],
      { strategy: 'send', syncBooks: false, deviceId: 'pc' },
    );

    expect(res.configsUploaded).toBe(0);
    expect(captured.writes.some((w) => w.path.endsWith('config.json'))).toBe(false);
  });
});
