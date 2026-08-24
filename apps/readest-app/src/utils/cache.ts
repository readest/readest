import { AppService, BaseDir, FileItem } from '@/types/system';
import { Book } from '@/types/book';
import { EXTS } from '@/libs/document';

const BOOK_EXTS = new Set(Object.values(EXTS));

export interface CacheClearProgress {
  current: number;
  total: number;
  currentFile?: string;
}

export interface CacheClearResult {
  deleted: number;
  failed: number;
}

/** A cache location to scan and clear. */
export interface CacheSource {
  base: BaseDir;
  /** Directory within `base` to scan; '' for the base root. */
  dir: string;
}

/** A single deletable file, with a path usable directly by deleteFile(path, base). */
export interface CacheEntry {
  base: BaseDir;
  path: string;
  size: number;
}

/**
 * List every file under the given cache sources as deletable entries. A source
 * that can't be read (e.g. an Inbox that doesn't exist yet) simply contributes
 * nothing instead of failing the whole scan.
 */
export const getCacheEntries = async (
  appService: AppService,
  sources: CacheSource[],
): Promise<CacheEntry[]> => {
  const entries: CacheEntry[] = [];
  for (const source of sources) {
    try {
      const files = await appService.readDirectory(source.dir, source.base);
      for (const file of files) {
        entries.push({
          base: source.base,
          path: source.dir ? `${source.dir}/${file.path}` : file.path,
          size: file.size || 0,
        });
      }
    } catch {
      // Missing or unreadable source — skip it.
    }
  }
  return entries;
};

/**
 * Files under Books/ that no live library book owns, as deletable entries:
 * everything in a `<hash>/` dir with no library row (an import killed before
 * the library was saved), plus any book file lingering in a soft-deleted
 * book's dir (a cloud tombstone never deletes local files). A plain delete
 * keeps cover.png and config.json there on purpose so a re-download resumes,
 * so those stay. Root-level library metadata is never an orphan. Neither kind
 * shows in the library UI, which is how they went unnoticed in #5837.
 */
export const getOrphanedBookEntries = async (
  appService: AppService,
  books: Book[],
): Promise<CacheEntry[]> => {
  const rows = new Map(books.map((book) => [book.hash, book]));
  let files: FileItem[];
  try {
    files = await appService.readDirectory('', 'Books');
  } catch {
    return [];
  }
  const entries: CacheEntry[] = [];
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/');
    const slashIdx = path.indexOf('/');
    if (slashIdx < 0) continue;
    const row = rows.get(path.slice(0, slashIdx));
    if (row && !row.deletedAt) continue;
    if (row && !BOOK_EXTS.has(path.split('.').pop()?.toLowerCase() ?? '')) continue;
    entries.push({ base: 'Books', path: file.path, size: file.size || 0 });
  }
  return entries;
};

/** Total file count and byte size for a set of cache entries. */
export const getCacheStats = (entries: CacheEntry[]): { count: number; size: number } => ({
  count: entries.length,
  size: entries.reduce((acc, entry) => acc + entry.size, 0),
});

/**
 * Delete the given cache entries one at a time, reporting progress before each
 * deletion. Individual failures are counted but never abort the loop, so a
 * single locked file can't leave the cache half-cleared without feedback.
 */
export const clearCacheEntries = async (
  appService: AppService,
  entries: CacheEntry[],
  onProgress?: (progress: CacheClearProgress) => void,
): Promise<CacheClearResult> => {
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    onProgress?.({ current: i + 1, total: entries.length, currentFile: entry.path });
    try {
      await appService.deleteFile(entry.path, entry.base);
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
};
