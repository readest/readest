// Per-book persistent TTS cache binding (see the design doc
// .agents/plans/2026-07-13-tts-cache-sqlite-packs.md): each book gets its
// own database under Cache/tts-cache/<book_hash>/, opened lazily on the
// first synthesize of a TTS session and closed when the client shuts down.
// Every failure path degrades to "no cache": playback must never depend on
// the cache working.
//
// The store also gets a pack filesystem so fully cached sections compact
// into one MP3 pack file each: plugin-fs under AppCache on Tauri platforms,
// OPFS in the browser (where supported). Compaction runs debounced after
// manifest updates and once more at session close.

import { isTauriAppPlatform } from '@/services/environment';
import type { DatabaseService } from '@/types/database';
import type { AppService } from '@/types/system';
import type { TTSCacheEntry, TTSCacheStore } from './cache';
import { sweepTTSCaches, touchTTSCacheMeta } from './cacheSweep';
import { createOpfsPackFs } from './opfsPackFs';
import { SqliteTTSCacheStore, TTSPackFs } from './sqliteCacheStore';

const CONFIG_KEY = 'readest-tts-cache';
const DEFAULT_BUDGET_MB = 200;
const COMPACT_DEBOUNCE_MS = 30_000;

export interface TTSCacheConfig {
  enabled: boolean;
  budgetMB: number;
  // Share section packs through the user's third-party file-sync provider.
  syncEnabled: boolean;
}

// localStorage-backed like the other TTS preferences (TTSUtils); a settings
// UI can edit the same key later.
export const getTTSCacheConfig = (): TTSCacheConfig => {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<TTSCacheConfig>) : {};
    return {
      enabled: parsed.enabled !== false,
      budgetMB: typeof parsed.budgetMB === 'number' ? parsed.budgetMB : DEFAULT_BUDGET_MB,
      syncEnabled: parsed.syncEnabled === true,
    };
  } catch {
    return { enabled: true, budgetMB: DEFAULT_BUDGET_MB, syncEnabled: false };
  }
};

// Applies to TTS sessions started after the change (the client reads the
// config when it is constructed).
export const setTTSCacheConfig = (config: TTSCacheConfig): void => {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // Storage full or unavailable; the default config keeps applying.
  }
};

// Pack file IO under AppCache via plugin-fs (native platforms only). The
// plugin modules load lazily so the web bundle never pulls them in.
const createNativePackFs = (dir: string): TTSPackFs => ({
  async write(name, data) {
    const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await writeFile(`${dir}/${name}`, data, { baseDir: BaseDirectory.AppCache });
  },
  async rename(from, to) {
    const { rename, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await rename(`${dir}/${from}`, `${dir}/${to}`, {
      oldPathBaseDir: BaseDirectory.AppCache,
      newPathBaseDir: BaseDirectory.AppCache,
    });
  },
  async readRange(name, offset, length) {
    const { open, BaseDirectory, SeekMode } = await import('@tauri-apps/plugin-fs');
    const file = await open(`${dir}/${name}`, { read: true, baseDir: BaseDirectory.AppCache });
    try {
      await file.seek(offset, SeekMode.Start);
      const buffer = new Uint8Array(length);
      let read = 0;
      while (read < length) {
        const n = await file.read(buffer.subarray(read));
        if (!n) break;
        read += n;
      }
      if (read !== length) throw new Error(`short pack read: ${read}/${length}`);
      return buffer.buffer as ArrayBuffer;
    } finally {
      await file.close();
    }
  },
  async remove(name) {
    const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    await remove(`${dir}/${name}`, { baseDir: BaseDirectory.AppCache });
  },
  async list() {
    const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs');
    const entries = await readDir(dir, { baseDir: BaseDirectory.AppCache });
    return entries.filter((entry) => entry.isFile).map((entry) => entry.name);
  },
});

export class BookTTSCacheStore implements TTSCacheStore {
  #appService: AppService;
  // The book key lands on the controller after construction (init()), so the
  // hash resolves lazily at first use.
  #getBookHash: () => string | null;
  #budgetBytes: number;
  #opening: Promise<{ db: DatabaseService; store: SqliteTTSCacheStore } | null> | null = null;
  #compactTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(appService: AppService, getBookHash: () => string | null, budgetBytes: number) {
    this.#appService = appService;
    this.#getBookHash = getBookHash;
    this.#budgetBytes = budgetBytes;
  }

  #open() {
    if (this.#opening) return this.#opening;
    const bookHash = this.#getBookHash();
    if (!bookHash) {
      // No book hash yet (the key binds to the controller on view attach):
      // the cache cannot open, so every op silently no-ops. Surfacing this
      // makes "downloads never persist" diagnosable instead of invisible.
      console.warn('TTS cache not opened: no book hash available yet');
      return Promise.resolve(null);
    }
    this.#opening = (async () => {
      try {
        const dir = `tts-cache/${bookHash}`;
        await this.#appService.createDir(dir, 'Cache', true);
        let packFs: TTSPackFs | undefined;
        if (isTauriAppPlatform()) {
          const packsDir = `${dir}/packs`;
          await this.#appService.createDir(packsDir, 'Cache', true);
          packFs = createNativePackFs(packsDir);
        } else {
          packFs = await createOpfsPackFs(`${dir}/packs`);
        }
        // 'tts-cache' has no registered migrations; the store owns its DDL.
        const db = await this.#appService.openDatabase('tts-cache', `${dir}/cache.db`, 'Cache');
        const store = new SqliteTTSCacheStore(db, { budgetBytes: this.#budgetBytes, packFs });
        // Sweep tmp files from crashed compactions and packs whose rows were
        // evicted before the file delete landed. Concurrent-safe: only files
        // unknown to the database are touched.
        void store.gcPackFiles().catch(() => {});
        // Stamp this book as in use, then enforce the cross-book budget by
        // deleting whole least-recently-used book caches (this book exempt).
        void touchTTSCacheMeta(this.#appService, bookHash).then(() =>
          sweepTTSCaches(this.#appService, bookHash, this.#budgetBytes),
        );
        // Adopt packs other devices produced (existence-checked, validated
        // on import); fire-and-forget like all cache housekeeping.
        this.#syncPacks(bookHash, store, 'pull');
        return { db, store };
      } catch (err) {
        console.warn('TTS cache unavailable for this session', err);
        return null;
      }
    })();
    return this.#opening;
  }

  async get(key: string): Promise<TTSCacheEntry | null> {
    const opened = await this.#open();
    return opened ? opened.store.get(key) : null;
  }

  async put(
    key: string,
    entry: TTSCacheEntry,
    meta?: { provider?: string; voice?: string },
  ): Promise<void> {
    const opened = await this.#open();
    await opened?.store.put(key, entry, meta);
  }

  async registerSectionMarks(section: number, marks: string[]): Promise<void> {
    const opened = await this.#open();
    if (!opened) return;
    await opened.store.registerSectionMarks(section, marks);
    this.#scheduleCompact();
  }

  async recordMarkKey(section: number, ordinal: number, key: string): Promise<void> {
    const opened = await this.#open();
    await opened?.store.recordMarkKey(section, ordinal, key);
  }

  // Immediate compaction for downloads (bypasses the debounced timer), then a
  // push if any packs were created and sync is on.
  async compact(): Promise<void> {
    const opened = await this.#open();
    if (!opened) return;
    const created = await opened.store.compact();
    const bookHash = this.#getBookHash();
    if (created > 0 && bookHash) this.#syncPacks(bookHash, opened.store, 'push');
  }

  async getSectionStatuses(): Promise<
    Map<number, { total: number; recorded: number; packed: boolean }>
  > {
    const opened = await this.#open();
    return opened ? opened.store.getSectionStatuses() : new Map();
  }

  async getSectionDurations(section: number, voice: string): Promise<Map<number, number>> {
    const opened = await this.#open();
    return opened ? opened.store.getSectionDurations(section, voice) : new Map();
  }

  async totalCacheBytes(): Promise<number> {
    const opened = await this.#open();
    return opened ? opened.store.totalCacheBytes() : 0;
  }

  // Compaction is idle work: debounce it behind manifest updates so it never
  // competes with the synthesis burst at section start.
  #scheduleCompact(): void {
    if (this.#compactTimer) clearTimeout(this.#compactTimer);
    this.#compactTimer = setTimeout(() => {
      this.#compactTimer = null;
      void this.#compactNow();
    }, COMPACT_DEBOUNCE_MS);
  }

  async #compactNow(): Promise<void> {
    try {
      const opened = await this.#opening;
      if (!opened) return;
      const created = await opened.store.compact();
      const bookHash = this.#getBookHash();
      if (created > 0 && bookHash) this.#syncPacks(bookHash, opened.store, 'push');
    } catch (err) {
      console.warn('TTS cache compaction failed', err);
    }
  }

  // Push/pull section packs through the selected file-sync provider. The
  // sync module is imported lazily: it must stay out of the TTS module
  // graph (settingsStore -> constants -> EdgeTTSClient would cycle) and out
  // of sessions that never enable sync.
  #syncPacks(bookHash: string, store: SqliteTTSCacheStore, direction: 'push' | 'pull'): void {
    if (!getTTSCacheConfig().syncEnabled) return;
    void (async () => {
      const { getActiveTTSPackSyncProvider, pullTTSPacks, pushTTSPacks } = await import(
        '@/services/sync/file/ttsPackSync'
      );
      const provider = await getActiveTTSPackSyncProvider();
      if (!provider) return;
      if (direction === 'pull') {
        await pullTTSPacks(provider, bookHash, store);
      } else {
        await pushTTSPacks(provider, bookHash, store);
      }
    })().catch((err) => {
      console.warn('TTS pack sync failed', err);
    });
  }

  async close(): Promise<void> {
    if (this.#compactTimer) {
      clearTimeout(this.#compactTimer);
      this.#compactTimer = null;
    }
    const opening = this.#opening;
    this.#opening = null;
    const opened = await opening;
    if (!opened) return;
    try {
      // Session end is the natural compaction point: sections finished
      // during this session merge into packs before the database closes.
      const created = await opened.store.compact();
      const bookHash = this.#getBookHash();
      if (created > 0 && bookHash) this.#syncPacks(bookHash, opened.store, 'push');
      await opened.store.flush();
    } catch (err) {
      console.warn('TTS cache close housekeeping failed', err);
    } finally {
      await opened.db.close();
      const bookHash = this.#getBookHash();
      if (bookHash) await touchTTSCacheMeta(this.#appService, bookHash);
    }
  }
}
