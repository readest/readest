import { describe, it, expect, vi } from 'vitest';
import { AppService, FileItem } from '@/types/system';
import { Book } from '@/types/book';
import {
  clearCacheEntries,
  getCacheEntries,
  getCacheStats,
  getOrphanedBookEntries,
  CacheClearProgress,
  CacheEntry,
} from '@/utils/cache';

const makeFiles = (...names: string[]): FileItem[] =>
  names.map((path, i) => ({ path, size: (i + 1) * 10 }));

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

describe('getOrphanedBookEntries (#5837)', () => {
  const LIVE = 'live-hash';
  const DELETED = 'deleted-hash';
  const ORPHAN = 'orphan-hash';

  it('returns every file of a hash dir no library row references', async () => {
    const readDirectory = vi
      .fn()
      .mockResolvedValue(makeFiles(`${ORPHAN}/book.epub`, `${ORPHAN}/cover.png`));
    const appService = { readDirectory } as unknown as AppService;

    const entries = await getOrphanedBookEntries(appService, [makeBook(LIVE)]);

    expect(readDirectory).toHaveBeenCalledWith('', 'Books');
    expect(entries).toEqual([
      { base: 'Books', path: `${ORPHAN}/book.epub`, size: 10 },
      { base: 'Books', path: `${ORPHAN}/cover.png`, size: 20 },
    ]);
  });

  it('never touches a live book dir or root-level library metadata', async () => {
    const readDirectory = vi
      .fn()
      .mockResolvedValue(
        makeFiles('library.json', 'library.json.bak', `${LIVE}/book.epub`, `${LIVE}/config.json`),
      );
    const appService = { readDirectory } as unknown as AppService;

    expect(await getOrphanedBookEntries(appService, [makeBook(LIVE)])).toEqual([]);
  });

  it('flags only lingering book files in a soft-deleted book dir', async () => {
    // A plain delete keeps cover.png and config.json on purpose (a re-download
    // resumes with them); a book file left there is the leftover to reclaim.
    const readDirectory = vi
      .fn()
      .mockResolvedValue(
        makeFiles(`${DELETED}/book.pdf`, `${DELETED}/cover.png`, `${DELETED}/config.json`),
      );
    const appService = { readDirectory } as unknown as AppService;

    const entries = await getOrphanedBookEntries(appService, [makeBook(DELETED, 5000)]);

    expect(entries).toEqual([{ base: 'Books', path: `${DELETED}/book.pdf`, size: 10 }]);
  });

  it('handles Windows backslash paths', async () => {
    const readDirectory = vi
      .fn()
      .mockResolvedValue(makeFiles(`${LIVE}\\book.epub`, `${ORPHAN}\\book.epub`));
    const appService = { readDirectory } as unknown as AppService;

    const entries = await getOrphanedBookEntries(appService, [makeBook(LIVE)]);

    expect(entries).toEqual([{ base: 'Books', path: `${ORPHAN}\\book.epub`, size: 20 }]);
  });

  it('contributes nothing when the Books dir cannot be read', async () => {
    const readDirectory = vi.fn().mockRejectedValue(new Error('unreadable'));
    const appService = { readDirectory } as unknown as AppService;

    expect(await getOrphanedBookEntries(appService, [])).toEqual([]);
  });
});

describe('getCacheStats', () => {
  it('sums file count and byte size', () => {
    const entries: CacheEntry[] = [
      { base: 'Cache', path: 'a', size: 10 },
      { base: 'Cache', path: 'b', size: 20 },
      { base: 'None', path: '/Inbox/c', size: 30 },
    ];
    expect(getCacheStats(entries)).toEqual({ count: 3, size: 60 });
  });

  it('returns zeros for an empty cache', () => {
    expect(getCacheStats([])).toEqual({ count: 0, size: 0 });
  });
});

describe('getCacheEntries', () => {
  it('reads the Cache base root with base-relative paths', async () => {
    const readDirectory = vi.fn().mockResolvedValue(makeFiles('x.json', 'y.epub'));
    const appService = { readDirectory } as unknown as AppService;

    const entries = await getCacheEntries(appService, [{ base: 'Cache', dir: '' }]);

    expect(readDirectory).toHaveBeenCalledWith('', 'Cache');
    expect(entries).toEqual([
      { base: 'Cache', path: 'x.json', size: 10 },
      { base: 'Cache', path: 'y.epub', size: 20 },
    ]);
  });

  it('prefixes a non-root source dir so paths are directly deletable (iOS Inbox)', async () => {
    const readDirectory = vi.fn().mockResolvedValue(makeFiles('book.epub'));
    const appService = { readDirectory } as unknown as AppService;

    const entries = await getCacheEntries(appService, [
      { base: 'None', dir: '/var/mobile/.../Documents/Inbox' },
    ]);

    expect(readDirectory).toHaveBeenCalledWith('/var/mobile/.../Documents/Inbox', 'None');
    expect(entries).toEqual([
      { base: 'None', path: '/var/mobile/.../Documents/Inbox/book.epub', size: 10 },
    ]);
  });

  it('merges multiple sources and skips unreadable ones', async () => {
    const readDirectory = vi
      .fn()
      .mockResolvedValueOnce(makeFiles('cache.json'))
      .mockRejectedValueOnce(new Error('no inbox'));
    const appService = { readDirectory } as unknown as AppService;

    const entries = await getCacheEntries(appService, [
      { base: 'Cache', dir: '' },
      { base: 'None', dir: '/Inbox' },
    ]);

    expect(entries).toEqual([{ base: 'Cache', path: 'cache.json', size: 10 }]);
  });
});

describe('clearCacheEntries', () => {
  it('deletes every entry with its own base and reports progress', async () => {
    const entries: CacheEntry[] = [
      { base: 'Cache', path: 'a.json', size: 10 },
      { base: 'Cache', path: 'b.epub', size: 20 },
      { base: 'None', path: '/Inbox/c.epub', size: 30 },
    ];
    const deleteFile = vi.fn().mockResolvedValue(undefined);
    const appService = { deleteFile } as unknown as AppService;
    const progress: CacheClearProgress[] = [];

    const result = await clearCacheEntries(appService, entries, (p) => progress.push(p));

    expect(result).toEqual({ deleted: 3, failed: 0 });
    expect(deleteFile).toHaveBeenCalledWith('a.json', 'Cache');
    expect(deleteFile).toHaveBeenCalledWith('/Inbox/c.epub', 'None');
    expect(progress).toEqual([
      { current: 1, total: 3, currentFile: 'a.json' },
      { current: 2, total: 3, currentFile: 'b.epub' },
      { current: 3, total: 3, currentFile: '/Inbox/c.epub' },
    ]);
  });

  it('counts failures without aborting the loop', async () => {
    const entries: CacheEntry[] = [
      { base: 'Cache', path: 'a', size: 1 },
      { base: 'Cache', path: 'b', size: 1 },
      { base: 'Cache', path: 'c', size: 1 },
    ];
    const deleteFile = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('locked'))
      .mockResolvedValueOnce(undefined);
    const appService = { deleteFile } as unknown as AppService;

    const result = await clearCacheEntries(appService, entries);

    expect(result).toEqual({ deleted: 2, failed: 1 });
    expect(deleteFile).toHaveBeenCalledTimes(3);
  });
});
