import { create } from 'zustand';

/**
 * Shared in-flight state for the library-wide WebDAV "Sync now" run.
 *
 * Lives outside React component state so the sync survives navigation
 * inside the Settings dialog (drilling out to the Integrations list, or
 * closing the dialog entirely and reopening it later) — `WebDAVForm`'s
 * old `useState` was destroyed on unmount, leaving the user with a
 * re-enabled "Sync now" button while the original `syncLibrary`
 * promise was still running off-thread, with no progress affordance
 * and the door open to spawning a second concurrent run.
 *
 * Scope is deliberately narrow:
 *   - Only the manual library Sync now path uses this. The per-book
 *     reader hook (`useWebDAVSync`) tracks its own state via refs and
 *     doesn't surface a button.
 *   - Not persisted to settings.json — process-local only. If the app
 *     is killed mid-sync, the in-memory promise dies with the renderer
 *     and this store starts fresh on next launch (which is the
 *     correct semantic: an aborted run should not look like it's
 *     still going).
 *   - We don't track structured progress (counters, per-book status
 *     etc.) — `syncLibrary.onProgress` already builds a localised
 *     label and the UI only ever displays it as a string. Keeping the
 *     store flat avoids re-implementing the formatting in two places.
 *
 * Re-entrancy: callers MUST gate on `isSyncing` *before* flipping it.
 * The `beginSync` action does not itself enforce mutual exclusion —
 * we keep the store dumb and let the handler decide because the
 * handler also has to do auth/library pre-flight checks that should
 * run after the gate.
 */
interface WebDAVSyncState {
  /** True while a library-wide Sync now is currently running. */
  isSyncing: boolean;
  /**
   * Localised progress string. Set by `syncLibrary.onProgress` via
   * `updateProgress`; rendered verbatim by the form. Null when no run
   * is active.
   */
  progressLabel: string | null;
  /** Wall-clock millis when the current run kicked off, or null. */
  startedAt: number | null;

  beginSync: (initialLabel: string) => void;
  updateProgress: (label: string) => void;
  endSync: () => void;
}

export const useWebDAVSyncStore = create<WebDAVSyncState>((set) => ({
  isSyncing: false,
  progressLabel: null,
  startedAt: null,

  beginSync: (initialLabel) =>
    set({ isSyncing: true, progressLabel: initialLabel, startedAt: Date.now() }),
  updateProgress: (label) => set({ progressLabel: label }),
  endSync: () => set({ isSyncing: false, progressLabel: null, startedAt: null }),
}));
