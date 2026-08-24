import { AppService, BaseDir, FileItem } from '@/types/system';
import { Book } from '@/types/book';
import { getAudiobookDirectory } from '@/services/audiobook/storage';
import { getBookDirOfPath } from './book';

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
 * Sidecars that are never reclaimed. A plain (non-purge) delete keeps them in
 * a soft-deleted book's dir on purpose so a re-download resumes with its
 * cover, progress, and notes, and a transiently opened file keeps its
 * progress in a dir no saved row owns. The paired audiobook copies under
 * `audiobook/` stay with them: config.json still points at those files, and
 * only the pairing's own removal path clears that association.
 */
const KEPT_SIDECARS = new Set(['cover.png', 'config.json', 'nav.json']);

/**
 * A dir written more recently than this may belong to an import whose row is
 * not in the library yet: files land in Books/<hash>/ before the caller saves
 * the row, and OPDS auto-download and restore persist a whole batch at once.
 * Such dirs are left alone until they settle.
 */
const ORPHAN_SETTLE_MS = 60 * 60 * 1000;

/**
 * Files under Books/ that no live library book owns, as deletable entries:
 * everything but the kept sidecars in a `<hash>/` dir with no library row
 * (an import killed before the library was saved) or with a soft-deleted one
 * (a book file a cloud tombstone never removed, a paired audiobook copy, a
 * feed's article cache). Root-level library metadata is never an orphan.
 * Neither kind shows in the library UI, which is how they went unnoticed in
 * #5837.
 */
export const getOrphanedBookEntries = async (
  appService: AppService,
  books: Book[],
): Promise<CacheEntry[]> => {
  // Any live row protects its dir, even if a legacy library.json also carries
  // a tombstone for the same hash.
  const liveHashes = new Set(books.filter((book) => !book.deletedAt).map((book) => book.hash));
  let files: FileItem[];
  try {
    // Scan by absolute path: a base-relative read of 'Books' resolves to a
    // Tauri baseDir and misses the native Rust walk, falling back to one IPC
    // round-trip per entry. Paths still come back relative to Books/.
    const booksDir = await appService.resolveFilePath('', 'Books');
    files = await appService.readDirectory(booksDir, 'None');
  } catch {
    return [];
  }
  const now = Date.now();
  const settled = new Map<string, Promise<boolean>>();
  // One stat per candidate dir; an unreadable or unknown mtime counts as
  // unsettled so nothing is offered on a guess.
  const isSettled = (dir: string) => {
    let result = settled.get(dir);
    if (!result) {
      result = appService
        .stats(dir, 'Books')
        .then(({ mtime }) => !!mtime && now - mtime.getTime() >= ORPHAN_SETTLE_MS)
        .catch(() => false);
      settled.set(dir, result);
    }
    return result;
  };
  const entries: CacheEntry[] = [];
  for (const file of files) {
    const dir = getBookDirOfPath(file.path);
    if (!dir || liveHashes.has(dir)) continue;
    const path = file.path.replace(/\\/g, '/');
    if (KEPT_SIDECARS.has(path.slice(dir.length + 1))) continue;
    if (path.startsWith(`${getAudiobookDirectory(dir)}/`)) continue;
    if (!(await isSettled(dir))) continue;
    entries.push({ base: 'Books', path: file.path, size: file.size || 0 });
  }
  return entries;
};

/**
 * Drop the Books/ entries whose dir a live library row owns by now: a sync or
 * import may have persisted a book between the scan and the confirm.
 */
export const withoutLiveBookEntries = (entries: CacheEntry[], books: Book[]): CacheEntry[] => {
  const live = new Set(books.filter((book) => !book.deletedAt).map((book) => book.hash));
  return entries.filter(
    (entry) => entry.base !== 'Books' || !live.has(getBookDirOfPath(entry.path) ?? ''),
  );
};

/**
 * Everything Manage Cache may delete: the cache sources plus orphaned book
 * files under Books/ (#5837). Orphans are only knowable against a loaded,
 * non-empty library: an unloaded one would mark every book on disk as an
 * orphan, and so would a library.json that failed to load (safeLoadJSON
 * hands back `[]`), whose Books/<hash>/ dirs are then the only copy left.
 * Both cases leave orphans out.
 */
export const getClearableEntries = async (
  appService: AppService,
  sources: CacheSource[],
  library: { books: Book[]; loaded: boolean },
): Promise<{ entries: CacheEntry[]; orphanCount: number }> => {
  const cacheEntries = await getCacheEntries(appService, sources);
  const orphanEntries =
    library.loaded && library.books.length > 0
      ? await getOrphanedBookEntries(appService, library.books)
      : [];
  return { entries: [...cacheEntries, ...orphanEntries], orphanCount: orphanEntries.length };
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
