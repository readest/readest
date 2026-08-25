import { describe, it, expect, vi } from 'vitest';
import { AppService, FileItem } from '@/types/system';
import { Book } from '@/types/book';
import { getOrphanedBookEntries } from '@/utils/cache';

const makeBook = (hash: string, deletedAt: number | null = null): Book =>
  ({
    hash,
    format: 'EPUB',
    title: hash,
    author: '',
    createdAt: 1,
    updatedAt: 1,
    deletedAt,
  }) as Book;

/**
 * Books/ resolves to an absolute dir so the scan takes the native walk; every
 * dir was last written long ago, so nothing is held back as an in-flight import.
 */
const makeBooksFs = (files: FileItem[]): AppService =>
  ({
    readDirectory: vi.fn().mockResolvedValue(files),
    resolveFilePath: async () => '/data/Books',
    stats: async () => ({ mtime: new Date(0) }),
  }) as unknown as AppService;

describe('getOrphanedBookEntries edges (#5837)', () => {
  const DELETED = 'deleted-hash';
  const ORPHAN_A = 'orphan-a';
  const ORPHAN_B = 'orphan-b';

  it('keeps the sidecars of a soft-deleted book on Windows backslash paths', async () => {
    const appService = makeBooksFs([
      { path: `${DELETED}\\cover.png`, size: 10 },
      { path: `${DELETED}\\config.json`, size: 20 },
      { path: `${DELETED}\\nav.json`, size: 30 },
      { path: `${DELETED}\\book.epub`, size: 40 },
    ]);

    const entries = await getOrphanedBookEntries(appService, [makeBook(DELETED, 5000)]);

    expect(entries).toEqual([{ base: 'Books', path: `${DELETED}\\book.epub`, size: 40 }]);
  });

  it('only protects sidecars at the top of a soft-deleted book dir', async () => {
    // A nested file that happens to share a sidecar name is still a leftover.
    const appService = makeBooksFs([
      { path: `${DELETED}/cover.png`, size: 10 },
      { path: `${DELETED}/articles/cover.png`, size: 20 },
    ]);

    const entries = await getOrphanedBookEntries(appService, [makeBook(DELETED, 5000)]);

    expect(entries).toEqual([{ base: 'Books', path: `${DELETED}/articles/cover.png`, size: 20 }]);
  });

  it('reports a missing size as 0 so stats never see NaN', async () => {
    const appService = makeBooksFs([{ path: `${ORPHAN_A}/book.epub` } as FileItem]);

    const entries = await getOrphanedBookEntries(appService, []);

    expect(entries).toEqual([{ base: 'Books', path: `${ORPHAN_A}/book.epub`, size: 0 }]);
  });

  it('flags every hash dir when the library is empty', async () => {
    // This is why the dialog only scans once `libraryLoaded` is true: an
    // unloaded (empty) library would mark every book on disk as an orphan.
    const appService = makeBooksFs([
      { path: 'library.json', size: 5 },
      { path: `${ORPHAN_A}/book.epub`, size: 10 },
      { path: `${ORPHAN_B}/book.pdf`, size: 20 },
    ]);

    const entries = await getOrphanedBookEntries(appService, []);

    expect(entries.map((e) => e.path)).toEqual([`${ORPHAN_A}/book.epub`, `${ORPHAN_B}/book.pdf`]);
  });

  it('contributes nothing when the Books dir cannot be resolved', async () => {
    const readDirectory = vi.fn();
    const appService = {
      readDirectory,
      resolveFilePath: vi.fn().mockRejectedValue(new Error('no data dir')),
    } as unknown as AppService;

    expect(await getOrphanedBookEntries(appService, [])).toEqual([]);
    expect(readDirectory).not.toHaveBeenCalled();
  });
});
