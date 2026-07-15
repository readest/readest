// Cross-book budget enforcement for the per-book TTS caches: the intra-book
// eviction inside SqliteTTSCacheStore keeps each book under the budget, and
// this sweep keeps the SUM across books under the same budget by deleting
// whole least-recently-used book cache directories. Runs fire-and-forget
// when a book's cache opens; every failure is swallowed — housekeeping must
// never affect playback.

import type { AppService } from '@/types/system';

const TTS_CACHE_ROOT = 'tts-cache';
const META_FILE = 'meta.json';
// Never sweep a cache stamped within this window: a recent stamp usually
// means another window's live session (its database may be open right now).
const RECENT_USE_GRACE_MS = 10 * 60 * 1000;

// Stamp a book cache as in use; written when the per-book store opens and
// closes so the sweep can order books by real usage.
export const touchTTSCacheMeta = async (
  appService: AppService,
  bookHash: string,
): Promise<void> => {
  try {
    await appService.writeFile(
      `${TTS_CACHE_ROOT}/${bookHash}/${META_FILE}`,
      'Cache',
      JSON.stringify({ lastUsedAt: Date.now() }),
    );
  } catch {
    // Missing dir or full disk: the sweep just treats the book as unstamped.
  }
};

export const sweepTTSCaches = async (
  appService: AppService,
  activeBookHash: string,
  budgetBytes: number,
  now: () => number = Date.now,
): Promise<void> => {
  try {
    // Recursive listing with sizes; paths are host-separator relative paths
    // like `<hash>/packs/3-abcd1234.mp3` (backslashes on Windows).
    const files = await appService.readDirectory(TTS_CACHE_ROOT, 'Cache');
    const books = new Map<string, { size: number }>();
    for (const file of files) {
      const hash = file.path.split(/[/\\]/)[0];
      if (!hash) continue;
      const book = books.get(hash) ?? { size: 0 };
      book.size += file.size;
      books.set(hash, book);
    }
    let total = [...books.values()].reduce((sum, book) => sum + book.size, 0);
    if (total <= budgetBytes) return;

    const candidates: { hash: string; size: number; lastUsedAt: number }[] = [];
    for (const [hash, book] of books) {
      if (hash === activeBookHash) continue;
      let lastUsedAt = 0;
      try {
        const raw = (await appService.readFile(
          `${TTS_CACHE_ROOT}/${hash}/${META_FILE}`,
          'Cache',
          'text',
        )) as string;
        const parsed = JSON.parse(raw) as { lastUsedAt?: number };
        if (typeof parsed.lastUsedAt === 'number') lastUsedAt = parsed.lastUsedAt;
      } catch {
        // No stamp: oldest possible candidate.
      }
      if (now() - lastUsedAt < RECENT_USE_GRACE_MS) continue;
      candidates.push({ hash, size: book.size, lastUsedAt });
    }
    candidates.sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    for (const candidate of candidates) {
      if (total <= budgetBytes) break;
      try {
        await appService.deleteDir(`${TTS_CACHE_ROOT}/${candidate.hash}`, 'Cache', true);
        total -= candidate.size;
      } catch (err) {
        console.warn('TTS cache sweep failed to delete', candidate.hash, err);
      }
    }
  } catch {
    // Root dir missing (fresh install, web OPFS) or listing unsupported.
  }
};
