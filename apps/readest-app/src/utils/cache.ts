import { AppService, BaseDir } from '@/types/system';

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
