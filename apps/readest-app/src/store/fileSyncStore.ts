import { create } from 'zustand';
import type { FileSyncBackendKind } from '@/services/sync/file/providerRegistry';

/**
 * Shared in-flight state for the library-wide file-sync "Sync now" run,
 * generalised across backends (WebDAV, Google Drive, ...). Was `webdavSyncStore`.
 *
 * Lives outside React component state so the sync survives navigation inside the
 * Settings dialog (drilling out to the Integrations list, or closing the dialog
 * and reopening it) — a component `useState` would be destroyed on unmount,
 * leaving a re-enabled "Sync now" button while the original `syncLibrary`
 * promise was still running, with no progress affordance.
 *
 * Two responsibilities:
 *   - **Per-backend progress.** Each backend has its own progress entry under
 *     {@link byKind} so its Integrations row + form can render independently.
 *   - **A global library-sync mutex.** Every backend's `syncLibrary` mutates the
 *     SAME local library (adds downloaded books, reconciles metadata), so two
 *     backends must not run a manual Sync now at once. {@link beginSync} acquires
 *     the lock and returns `false` when another backend already holds it.
 *
 * Scope is deliberately narrow: only the manual library Sync now path uses this
 * (the per-book reader hook tracks its own refs and surfaces no button), and it
 * is process-local — never persisted, so an app killed mid-sync starts fresh.
 */
export interface ProviderSyncProgress {
  /** True while this backend's library-wide Sync now is running. */
  isSyncing: boolean;
  /** Localised status line (e.g. "Uploading 3 / 12"), or null when idle. */
  progressLabel: string | null;
  /** Secondary line — the current book's title — or null. */
  progressDetail: string | null;
  /** Wall-clock millis when this backend's run kicked off, or null. */
  startedAt: number | null;
}

/** Stable idle snapshot, so absent-backend selectors keep a constant identity. */
const IDLE: ProviderSyncProgress = Object.freeze({
  isSyncing: false,
  progressLabel: null,
  progressDetail: null,
  startedAt: null,
});

interface FileSyncState {
  /** Per-backend progress; absent entries are idle (see {@link IDLE}). */
  byKind: Partial<Record<FileSyncBackendKind, ProviderSyncProgress>>;
  /** The backend currently holding the library-sync lock, or null when free. */
  activeKind: FileSyncBackendKind | null;
  /**
   * Last terminal sync error per backend, surviving `endSync` so health
   * surfaces (the SettingsMenu sync row, the chooser row status) can show
   * "Sync failed" after the run finished. Cleared (set to null) by the
   * next successful run. Process-local like the rest of this store — the
   * durable "last synced" timestamp lives in the provider settings slice.
   */
  lastErrorByKind: Partial<Record<FileSyncBackendKind, string | null>>;
  /** Once-per-session latch for the mixed-fleet notice (see fleetDetection.ts). */
  fleetNoticeShown: boolean;

  /**
   * Acquire the library-sync mutex for `kind` and mark it syncing. Returns
   * `true` on success; `false` (leaving state untouched) when another backend
   * already holds the lock. Callers MUST honour a `false` return and not sync.
   */
  beginSync: (kind: FileSyncBackendKind, initialLabel: string) => boolean;
  updateProgress: (kind: FileSyncBackendKind, label: string, detail?: string | null) => void;
  endSync: (kind: FileSyncBackendKind) => void;
  setLastError: (kind: FileSyncBackendKind, message: string | null) => void;
  setFleetNoticeShown: () => void;
}

export const useFileSyncStore = create<FileSyncState>((set, get) => ({
  byKind: {},
  activeKind: null,
  lastErrorByKind: {},
  fleetNoticeShown: false,

  beginSync: (kind, initialLabel) => {
    // Global mutex: only one backend's library sync at a time, since they all
    // mutate the same local library.
    if (get().activeKind !== null) return false;
    set((s) => ({
      activeKind: kind,
      byKind: {
        ...s.byKind,
        [kind]: {
          isSyncing: true,
          progressLabel: initialLabel,
          progressDetail: null,
          startedAt: Date.now(),
        },
      },
    }));
    return true;
  },

  updateProgress: (kind, label, detail = null) =>
    set((s) => ({
      byKind: {
        ...s.byKind,
        [kind]: {
          ...(s.byKind[kind] ?? IDLE),
          isSyncing: true,
          progressLabel: label,
          progressDetail: detail,
        },
      },
    })),

  endSync: (kind) =>
    set((s) => ({
      activeKind: s.activeKind === kind ? null : s.activeKind,
      byKind: { ...s.byKind, [kind]: IDLE },
    })),

  setLastError: (kind, message) =>
    set((s) => ({
      lastErrorByKind: { ...s.lastErrorByKind, [kind]: message },
    })),

  setFleetNoticeShown: () => set({ fleetNoticeShown: true }),
}));

/** Per-backend progress, idle when the backend has never started a run. */
export const selectProviderSyncProgress =
  (kind: FileSyncBackendKind) =>
  (state: FileSyncState): ProviderSyncProgress =>
    state.byKind[kind] ?? IDLE;
