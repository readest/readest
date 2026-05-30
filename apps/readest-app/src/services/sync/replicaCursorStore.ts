import type { AppService } from '@/types/system';
import type { Hlc } from '@/types/replica';
import type { CursorStore } from './replicaSyncManager';

export interface SettingsCursorStoreOpts {
  /** Debounce window for the load-merge-save flush. Defaults to 1s. */
  debounceMs?: number;
  /** Test seam — defaults to the platform setTimeout. */
  setTimeoutFn?: typeof setTimeout;
  /** Test seam. */
  clearTimeoutFn?: typeof clearTimeout;
}

/**
 * Production CursorStore backed by appService.loadSettings + saveSettings.
 *
 * Cursors are cached in memory so get() is sync. set() debounces a save
 * that does a fresh load-merge-save round-trip — this keeps us from
 * clobbering fields written elsewhere in the same session (e.g., the
 * library page's setSettings).
 *
 * Cursor advance is best-effort: a lost save just means the next pull
 * re-fetches a few rows. We never block the sync flow on disk IO.
 */
export const createSettingsCursorStore = (
  appService: AppService,
  opts: SettingsCursorStoreOpts = {},
): CursorStore => {
  const cache = new Map<string, Hlc>();
  const setTimeoutFn = opts.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = opts.clearTimeoutFn ?? clearTimeout;
  const debounceMs = opts.debounceMs ?? 1000;
  let pending: ReturnType<typeof setTimeout> | null = null;

  void (async () => {
    try {
      const settings = await appService.loadSettings();
      for (const [k, v] of Object.entries(settings.lastSyncedAtReplicas ?? {})) {
        cache.set(k, v as Hlc);
      }
    } catch (err) {
      console.warn('replica cursor hydrate failed', err);
    }
  })();

  const flush = async () => {
    try {
      const settings = await appService.loadSettings();
      settings.lastSyncedAtReplicas = Object.fromEntries(cache);
      await appService.saveSettings(settings);
    } catch (err) {
      console.warn('replica cursor save failed', err);
    }
  };

  const scheduleFlush = () => {
    if (pending !== null) clearTimeoutFn(pending);
    pending = setTimeoutFn(() => {
      pending = null;
      void flush();
    }, debounceMs);
  };

  return {
    get: (kind) => cache.get(kind) ?? null,
    set: (kind, hlc) => {
      cache.set(kind, hlc);
      scheduleFlush();
    },
  };
};
