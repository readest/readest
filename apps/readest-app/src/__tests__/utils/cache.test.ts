import { describe, it, expect, vi } from 'vitest';
import { AppService, FileItem } from '@/types/system';
import { Book } from '@/types/book';
import {
  clearCacheEntries,
  getCacheEntries,
  getCacheStats,
  getClearableEntries,
  getOrphanedBookEntries,
  withoutLiveBookEntries,
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

/**
 * Books/ resolves to an absolute dir so the scan takes the native walk; dirs
 * were last written long ago unless a test says otherwise.
 */
const makeBooksFs = (
  readDirectory: ReturnType<typeof vi.fn>,
  stats: () => Promise<{ mtime: Date | null }> = async () => ({ mtime: new Date(0) }),
): AppService =>
  ({ readDirectory, resolveFilePath: async () => '/data/Books', stats }) as unknown as AppService;

describe('getOrphanedBookEntries (#5837)', () => {
  const LIVE = 'live-hash';
  const DELETED = 'deleted-hash';
  const ORPHAN = 'orphan-hash';

  it('reclaims everything but the kept sidecars in a dir no library row references', async () => {
    // A transiently opened file keeps its progress in such a dir.
    const readDirectory = vi
      .fn()
      .mockResolvedValue(
        makeFiles(`${ORPHAN}/book.epub`, `${ORPHAN}/cover.png`, `${ORPHAN}/config.json`),
      );
    const appService = makeBooksFs(readDirectory);

    const entries = await getOrphanedBookEntries(appService, [makeBook(LIVE)]);

    expect(readDirectory).toHaveBeenCalledWith('/data/Books', 'None');
    expect(entries).toEqual([{ base: 'Books', path: `${ORPHAN}/book.epub`, size: 10 }]);
  });

  it('leaves a dir written in the last hour alone, as an import may still own it', async () => {
    const readDirectory = vi.fn().mockResolvedValue(makeFiles(`${ORPHAN}/book.epub`));
    const fresh = makeBooksFs(readDirectory, async () => ({ mtime: new Date() }));
    const unknown = makeBooksFs(readDirectory, async () => ({ mtime: null }));
    const unreadable = makeBooksFs(readDirectory, async () => {
      throw new Error('stat failed');
    });

    expect(await getOrphanedBookEntries(fresh, [])).toEqual([]);
    expect(await getOrphanedBookEntries(unknown, [])).toEqual([]);
    expect(await getOrphanedBookEntries(unreadable, [])).toEqual([]);
  });

  it('stats each candidate dir once', async () => {
    const readDirectory = vi
      .fn()
      .mockResolvedValue(makeFiles(`${ORPHAN}/a.epub`, `${ORPHAN}/b.pdf`, `${LIVE}/book.epub`));
    const stats = vi.fn().mockResolvedValue({ mtime: new Date(0) });
    const appService = makeBooksFs(readDirectory, stats);

    const entries = await getOrphanedBookEntries(appService, [makeBook(LIVE)]);

    expect(entries.map((e) => e.path)).toEqual([`${ORPHAN}/a.epub`, `${ORPHAN}/b.pdf`]);
    expect(stats).toHaveBeenCalledTimes(1);
    expect(stats).toHaveBeenCalledWith(ORPHAN, 'Books');
  });

  it('never touches a live book dir or root-level library metadata', async () => {
    const readDirectory = vi
      .fn()
      .mockResolvedValue(
        makeFiles('library.json', 'library.json.bak', `${LIVE}/book.epub`, `${LIVE}/config.json`),
      );
    const appService = makeBooksFs(readDirectory);

    expect(await getOrphanedBookEntries(appService, [makeBook(LIVE)])).toEqual([]);
  });

  it('reclaims everything but the kept sidecars in a soft-deleted book dir', async () => {
    // A plain delete keeps cover.png, config.json and nav.json on purpose (a
    // re-download resumes with them), and config.json still points at the
    // paired audiobook copies. A lingering book file or a feed's article
    // cache are leftovers to reclaim.
    const readDirectory = vi
      .fn()
      .mockResolvedValue(
        makeFiles(
          `${DELETED}/book.pdf`,
          `${DELETED}/cover.png`,
          `${DELETED}/config.json`,
          `${DELETED}/nav.json`,
          `${DELETED}/audiobook/1-2-track.m4b`,
          `${DELETED}/articles/x.html`,
        ),
      );
    const appService = makeBooksFs(readDirectory);

    const entries = await getOrphanedBookEntries(appService, [makeBook(DELETED, 5000)]);

    expect(entries).toEqual([
      { base: 'Books', path: `${DELETED}/book.pdf`, size: 10 },
      { base: 'Books', path: `${DELETED}/articles/x.html`, size: 60 },
    ]);
  });

  it('lets any live row protect a dir a duplicate tombstone also names', async () => {
    // A legacy library.json is not deduplicated on load.
    const readDirectory = vi.fn().mockResolvedValue(makeFiles(`${LIVE}/book.epub`));
    const appService = makeBooksFs(readDirectory);

    const entries = await getOrphanedBookEntries(appService, [
      makeBook(LIVE),
      makeBook(LIVE, 5000),
    ]);

    expect(entries).toEqual([]);
  });

  it('handles Windows backslash paths', async () => {
    const readDirectory = vi
      .fn()
      .mockResolvedValue(makeFiles(`${LIVE}\\book.epub`, `${ORPHAN}\\book.epub`));
    const appService = makeBooksFs(readDirectory);

    const entries = await getOrphanedBookEntries(appService, [makeBook(LIVE)]);

    expect(entries).toEqual([{ base: 'Books', path: `${ORPHAN}\\book.epub`, size: 20 }]);
  });

  it('contributes nothing when the Books dir cannot be read', async () => {
    const readDirectory = vi.fn().mockRejectedValue(new Error('unreadable'));
    const appService = makeBooksFs(readDirectory);

    expect(await getOrphanedBookEntries(appService, [])).toEqual([]);
  });
});

describe('withoutLiveBookEntries (#5837)', () => {
  it('drops Books entries whose dir a live row owns by confirm time', () => {
    const entries: CacheEntry[] = [
      { base: 'Cache', path: 'x.json', size: 10 },
      { base: 'Books', path: 'abc/book.epub', size: 20 },
      { base: 'Books', path: 'def\\book.epub', size: 30 },
    ];

    const kept = withoutLiveBookEntries(entries, [makeBook('abc'), makeBook('def', 5000)]);

    expect(kept).toEqual([
      { base: 'Cache', path: 'x.json', size: 10 },
      { base: 'Books', path: 'def\\book.epub', size: 30 },
    ]);
  });
});

describe('getClearableEntries (#5837)', () => {
  const sources = [{ base: 'Cache' as const, dir: '' }];
  // Cache root holds one file; the Books tree holds a hash dir no row owns.
  const readDirectory = () =>
    vi
      .fn()
      .mockImplementation(async (_path: string, base: string) =>
        base === 'Cache' ? makeFiles('x.json') : makeFiles('abc/book.epub'),
      );

  it('leaves orphans out while the library is not loaded', async () => {
    // An unloaded library would make every book on disk look orphaned.
    const appService = makeBooksFs(readDirectory());

    const result = await getClearableEntries(appService, sources, {
      books: [makeBook('live')],
      loaded: false,
    });

    expect(result).toEqual({
      entries: [{ base: 'Cache', path: 'x.json', size: 10 }],
      orphanCount: 0,
    });
  });

  it('leaves orphans out when the library loaded with no rows at all', async () => {
    // A library.json that failed to load hands back []; the hash dirs on
    // disk are then the only copy of the books and must not be offered.
    const appService = makeBooksFs(readDirectory());

    const result = await getClearableEntries(appService, sources, { books: [], loaded: true });

    expect(result.orphanCount).toBe(0);
    expect(result.entries.filter((e) => e.base === 'Books')).toEqual([]);
  });

  it('appends and counts orphans once a non-empty library is loaded', async () => {
    const appService = makeBooksFs(readDirectory());

    const result = await getClearableEntries(appService, sources, {
      books: [makeBook('live')],
      loaded: true,
    });

    expect(result).toEqual({
      entries: [
        { base: 'Cache', path: 'x.json', size: 10 },
        { base: 'Books', path: 'abc/book.epub', size: 10 },
      ],
      orphanCount: 1,
    });
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
