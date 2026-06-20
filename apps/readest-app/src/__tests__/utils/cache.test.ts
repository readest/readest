import { describe, it, expect, vi } from 'vitest';
import { AppService, FileItem } from '@/types/system';
import {
  clearCacheEntries,
  getCacheEntries,
  getCacheStats,
  CacheClearProgress,
  CacheEntry,
} from '@/utils/cache';

const makeFiles = (...names: string[]): FileItem[] =>
  names.map((path, i) => ({ path, size: (i + 1) * 10 }));

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
