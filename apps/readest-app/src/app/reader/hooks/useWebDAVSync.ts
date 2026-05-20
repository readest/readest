import { useCallback, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import {
  pullBookConfig,
  pushBookConfig,
  pushBookCover,
  pushBookFile,
} from '@/services/webdav/WebDAVSync';
import { WebDAVRequestError } from '@/services/webdav/WebDAVClient';
import { isTauriAppPlatform } from '@/services/environment';
import { tauriUpload } from '@/utils/transfer';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import { removeBookNoteOverlays } from '../utils/annotatorUtil';
import { useWindowActiveChanged } from './useWindowActiveChanged';

/**
 * WebDAV per-book sync hook.
 *
 * Mirrors the architecture of `useKOSync` / `useProgressSync`: a single
 * Reader-level hook drives both progress and booknote sync against
 * `<rootPath>/Readest/books/<hash>/config.json`. Pull-once on book open,
 * debounced push on progress / booknote changes, manual flush on
 * `flush-webdav-sync` event.
 *
 * Energy budget — these constants are deliberately tuned for mobile:
 *   - Push debounce: 15 s. Real reading sessions involve continuous
 *     page-turns, so a longer window collapses many turns into one PUT.
 *   - Pull cooldown: 60 s. Window focus shouldn't trigger a fresh PROPFIND
 *     on every alt-tab; once a minute is plenty for cross-device drift.
 *   - Open-pull skip: 30 s. Quickly closing/reopening a book shouldn't
 *     re-fetch the same config that's already current in memory.
 *
 * Gating:
 *   - `settings.webdav.enabled` must be true (master switch on the WebDAV
 *     sub-page in Integrations)
 *   - `settings.webdav.serverUrl` and `settings.webdav.username` must be
 *     non-empty (the Connect flow guarantees this when enabled is true,
 *     but defensive check is cheap)
 *
 * Strategy semantics — same vocabulary as KOSync so users only learn one:
 *   - 'silent' (default): always push and always pull, latest writer wins
 *   - 'send':   push only, never pull (this device feeds others)
 *   - 'receive': pull only, never push (this device follows others)
 *   - 'prompt': not implemented in v1 — falls back to 'silent'
 */

/** Debounce window for auto-push triggered by progress / booknote churn. */
const PUSH_DEBOUNCE_MS = 15_000;
/** Minimum gap between automatic pulls (e.g. window-focus, open-book). */
const PULL_COOLDOWN_MS = 60_000;
/**
 * If this hook ran a successful pull less than this long ago for the
 * current book, skip the open-book pull entirely.
 *
 * Note: `lastPulledAtRef` is component-instance state, so closing the
 * reader unmounts the hook and resets the ref. A real "close-then-
 * reopen" therefore *doesn't* trigger this guard — the new instance
 * starts at 0 and proceeds to pull. The skip only fires when the
 * open-book effect re-runs within a single hook lifetime (e.g.
 * navigating between two books in the same reader window, or
 * progress arriving in two ticks before `hasPulledOnce` is set),
 * which is the common case we actually want to deduplicate.
 */
const OPEN_PULL_SKIP_MS = 30_000;

export const useWebDAVSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { getProgress, getViewsById, getView } = useReaderStore();
  const { getConfig, setConfig, getBookData, saveConfig } = useBookDataStore();
  const progress = getProgress(bookKey);

  /**
   * `dirtyRef` flips to true on the first locally-driven change after a
   * successful push, and back to false right before each push fires. We
   * use it to skip no-op flushes (e.g., user just opens then closes a
   * book without reading) so mobile doesn't burn a PUT for no reason.
   */
  const dirtyRef = useRef(false);
  /** Last successful pull timestamp; gates window-focus and open-book pulls. */
  const lastPulledAtRef = useRef(0);
  const hasPulledOnce = useRef(false);
  /**
   * Per-instance lock for the book-file uploader. Once we've HEAD-probed
   * (and possibly uploaded) the binary for this book in this hook
   * lifetime, we never re-do it — the file's content is hash-keyed so
   * the only thing that could change is the friendly filename, which is
   * a metadata-only operation handled elsewhere.
   */
  const fileSyncedRef = useRef(false);

  // The deviceId is generated lazily on first push so users who never
  // enable WebDAV don't carry it around.
  //
  // Read latest settings from the store rather than the closure for the
  // same reason `updateLastSyncedAt` does: `pullNow → pushNow` can fire
  // back-to-back when a book opens, and the closure's `settings` may
  // not reflect a sibling write that just landed (e.g. the settings
  // panel flipping `syncBooks`). A closure-based merge here would
  // rebuild the webdav block from a stale snapshot and silently
  // clobber that write.
  const ensureDeviceId = useCallback((): string => {
    const latest = useSettingsStore.getState().settings;
    let id = latest.webdav?.deviceId;
    if (!id) {
      id = uuidv4();
      const next = { ...latest, webdav: { ...latest.webdav, deviceId: id } };
      setSettings(next);
      saveSettings(envConfig, next);
    }
    return id;
  }, [envConfig, setSettings, saveSettings]);

  const updateLastSyncedAt = useCallback(
    async (ts: number) => {
      // Read the latest settings from the store rather than the
      // closure: pullNow → pushNow → pushBookFileNow can fire
      // back-to-back when a book opens, and the closure's `settings`
      // doesn't reflect interim writes by the prior call. Using the
      // closure here would let a second `updateLastSyncedAt` rebuild
      // the webdav object from a stale snapshot, clobbering whatever
      // the first call (or a sibling write like `syncLog` from the
      // settings panel) just committed.
      const latest = useSettingsStore.getState().settings;
      const next = { ...latest, webdav: { ...latest.webdav, lastSyncedAt: ts } };
      setSettings(next);
      await saveSettings(envConfig, next);
    },
    [envConfig, setSettings, saveSettings],
  );

  const isReady = useMemo(() => {
    const w = settings.webdav;
    return !!(w?.enabled && w?.serverUrl && w?.username);
  }, [settings.webdav]);

  const strategy = settings.webdav?.strategy ?? 'silent';
  const allowPush = isReady && strategy !== 'receive';
  const allowPull = isReady && strategy !== 'send';

  /**
   * Push the latest config (progress + booknotes) to the remote.
   * Skips while the user is previewing a deep-link target — the in-memory
   * position there reflects the annotation, not actual reading.
   */
  const pushNow = useCallback(async () => {
    if (!allowPush) return;
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
    // Default-on semantics for older settings.json files that predate
    // these keys (undefined in storage → opt in, not opt out).
    const wantProgress = settings.webdav?.syncProgress ?? true;
    const wantNotes = settings.webdav?.syncNotes ?? true;
    if (!wantProgress && !wantNotes) return;

    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return;

    try {
      const deviceId = ensureDeviceId();
      // We always push the full envelope; sub-toggles only gate _which_
      // fields the local writer applies on pull. This keeps the wire
      // schema stable across users with different toggle combinations.
      await pushBookConfig(settings.webdav!, book, config, deviceId);
      dirtyRef.current = false;
      await updateLastSyncedAt(Date.now());
    } catch (e) {
      if (e instanceof WebDAVRequestError && e.code === 'AUTH_FAILED') {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('WebDAV authentication failed. Reconnect in Settings.'),
        });
      } else {
        console.warn('WD push failed', e);
      }
    }
  }, [
    allowPush,
    bookKey,
    getConfig,
    getBookData,
    ensureDeviceId,
    settings.webdav,
    updateLastSyncedAt,
    _,
  ]);

  /**
   * Upload the book binary if syncBooks is on and the remote doesn't
   * already have a same-sized copy. Designed to be cheap on the steady
   * state — the underlying `pushBookFile` does a single HEAD before any
   * PUT, so for already-mirrored books we burn just one round-trip per
   * book per session. Re-runs of this callback within the same hook
   * instance no-op via `fileSyncedRef`.
   */
  const pushBookFileNow = useCallback(async () => {
    if (!allowPush) return;
    if (!(settings.webdav?.syncBooks ?? false)) return;
    if (fileSyncedRef.current) return;
    fileSyncedRef.current = true;

    const book = getBookData(bookKey)?.book;
    if (!book || !appService) return;

    try {
      const result = await pushBookFile(
        settings.webdav!,
        book,
        async () => {
          // Buffered fallback: read the local book file off disk lazily
          // so we only do the expensive ArrayBuffer materialisation when
          // the HEAD probe says we actually need to upload. Used on web
          // targets where streaming PUTs aren't available.
          const fp = getLocalBookFilename(book);
          if (!(await appService.exists(fp, 'Books'))) return null;
          const file = await appService.openFile(fp, 'Books');
          const bytes = await file.arrayBuffer();
          return { bytes, size: bytes.byteLength };
        },
        // Tauri-only: stream the book file straight from disk to the
        // server via Rust-side `upload_file`, never letting the bytes
        // land in the JS heap. Without this, opening a multi-hundred-
        // megabyte PDF / scanned book would buffer the whole file into
        // V8 just to PUT it, blowing the renderer's heap and freezing
        // the reader to a blank screen mid-open. Same flow as the
        // library Sync now path in WebDAVForm.
        isTauriAppPlatform()
          ? async () => {
              const fp = getLocalBookFilename(book);
              if (!(await appService.exists(fp, 'Books'))) return null;
              const file = await appService.openFile(fp, 'Books');
              const size = file.size;
              // Release the FD before streaming so the Tauri side can
              // re-open the path for the PUT without contending.
              const closable = file as { close?: () => Promise<void> };
              if (closable.close) await closable.close();
              const dst = await appService.resolveFilePath(fp, 'Books');
              return {
                size,
                upload: async (remoteUrl, headers) => {
                  try {
                    await tauriUpload(
                      remoteUrl,
                      dst,
                      'PUT',
                      undefined,
                      headers as unknown as Map<string, string>,
                    );
                    return true;
                  } catch (e) {
                    console.warn('WD per-book push: tauriUpload failed', book.hash, e);
                    return false;
                  }
                },
              };
            }
          : undefined,
      );
      if (result.uploaded) {
        await updateLastSyncedAt(Date.now());
      }
      // Cover ride-along — best-effort, failures don't unwind the
      // syncedRef lock or surface a toast. Same HEAD short-circuit as
      // the book file, so steady-state cost is one HEAD per session.
      try {
        await pushBookCover(settings.webdav!, book.hash, async () => {
          const fp = getCoverFilename(book);
          if (!(await appService.exists(fp, 'Books'))) return null;
          const file = await appService.openFile(fp, 'Books');
          const bytes = await file.arrayBuffer();
          return { bytes, size: bytes.byteLength };
        });
      } catch (e) {
        console.warn('WD book cover push failed', e);
      }
    } catch (e) {
      // Reset the lock on failure so a manual Sync now or a subsequent
      // open retries — otherwise a transient hiccup would mark this
      // book "synced" for the rest of the session.
      fileSyncedRef.current = false;
      if (e instanceof WebDAVRequestError && e.code === 'AUTH_FAILED') {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('WebDAV authentication failed. Reconnect in Settings.'),
        });
      } else {
        console.warn('WD book file push failed', e);
      }
    }
  }, [allowPush, settings.webdav, getBookData, bookKey, appService, updateLastSyncedAt, _]);

  /**
   * Pull, merge, and persist. Uses the same per-config / per-note merge
   * semantics as the native cloud sync so a user running both feels the
   * same behaviour from each.
   *
   * Returns `true` when remote already had a payload (merge happened),
   * `false` when remote was empty. Callers use that to decide whether to
   * follow up with an initial push (which is how the per-book directory
   * actually gets created on first use).
   */
  const pullNow = useCallback(async (): Promise<boolean> => {
    if (!allowPull) return false;
    const wantProgress = settings.webdav?.syncProgress ?? true;
    const wantNotes = settings.webdav?.syncNotes ?? true;
    if (!wantProgress && !wantNotes) return false;

    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return false;

    try {
      const result = await pullBookConfig(settings.webdav!, book, config);
      lastPulledAtRef.current = Date.now();
      if (!result.applied || !result.mergedConfig) return false;

      // Surface merged notes through the live view so highlights re-appear /
      // disappear without waiting for the next render pass.
      if (wantNotes && result.mergedNotes) {
        const view = getView(bookKey);
        const previousById = new Map((config.booknotes ?? []).map((n) => [n.id, n]));
        for (const note of result.mergedNotes) {
          const prev = previousById.get(note.id);
          if (note.deletedAt && (!prev || !prev.deletedAt)) {
            // Newly soft-deleted on the remote — strip overlays locally.
            getViewsById(bookKey.split('-')[0]!).forEach((v) => removeBookNoteOverlays(v, note));
          } else if (!note.deletedAt && note.cfi && view) {
            // Newly added or re-surrected; only render in the live spine.
            try {
              view.addAnnotation(note);
            } catch {
              // The annotation may not belong to the current spine index;
              // it'll get rendered when that section is loaded.
            }
          }
        }
      }

      // Honour sub-toggles: drop the parts the user opted out of before
      // writing back to the local config store.
      const toApply = { ...result.mergedConfig };
      if (!wantProgress) {
        toApply.progress = config.progress;
        toApply.location = config.location;
        toApply.xpointer = config.xpointer;
      }
      if (!wantNotes) {
        toApply.booknotes = config.booknotes;
      }

      setConfig(bookKey, toApply);
      // Persist locally so a later session sees the merged state even if
      // the user closes the book without further interaction.
      const latest = getConfig(bookKey);
      if (latest) await saveConfig(envConfig, bookKey, latest, settings);
      await updateLastSyncedAt(Date.now());
      return true;
    } catch (e) {
      if (e instanceof WebDAVRequestError && e.code === 'AUTH_FAILED') {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('WebDAV authentication failed. Reconnect in Settings.'),
        });
      } else {
        console.warn('WD pull failed', e);
      }
      return false;
    }
  }, [
    allowPull,
    bookKey,
    getConfig,
    getBookData,
    getView,
    getViewsById,
    setConfig,
    saveConfig,
    envConfig,
    settings,
    updateLastSyncedAt,
    _,
  ]);

  // Stash the latest pull/push callbacks in a ref so the event-bridge
  // useEffect below doesn't have to re-bind on every render. Pattern
  // taken from useKOSync.
  const syncRefs = useRef({ pushNow, pullNow, pushBookFileNow });
  useEffect(() => {
    syncRefs.current = { pushNow, pullNow, pushBookFileNow };
  }, [pushNow, pullNow, pushBookFileNow]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedPush = useCallback(
    debounce(() => {
      // Skip the network round-trip when nothing has changed since the
      // last successful push (the dirtyRef.current = false in pushNow's
      // success path).
      if (!dirtyRef.current) return;
      syncRefs.current.pushNow();
    }, PUSH_DEBOUNCE_MS),
    [],
  );

  /**
   * Mark dirty + schedule a debounced push. Centralises the pattern so
   * progress / booknote effects don't both have to remember to flip the
   * dirty bit.
   */
  const markDirtyAndSchedule = useCallback(() => {
    dirtyRef.current = true;
    debouncedPush();
  }, [debouncedPush]);

  // Pull once on book open, then push if remote was empty so the per-book
  // directory gets created on first use rather than waiting for the user
  // to scroll several pages. We hold off until progress.location is known
  // so the merge has a real local side to compare against. The book file
  // upload is gated by syncBooks and rides along on the same trigger.
  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    if (hasPulledOnce.current) return;
    hasPulledOnce.current = true;
    // Same-instance dedupe — if we already pulled for this book within
    // the cooldown window, skip the second pull (and its bootstrap push)
    // since the remote almost certainly hasn't moved. See the comment
    // on `OPEN_PULL_SKIP_MS`: this guard only fires on re-runs of this
    // effect within one hook lifetime, not on close-then-reopen.
    if (Date.now() - lastPulledAtRef.current < OPEN_PULL_SKIP_MS) return;
    (async () => {
      const merged = await syncRefs.current.pullNow();
      if (!merged) {
        // Remote had nothing for this book yet — bootstrap the directory
        // structure (Readest/books/<hash>/) by uploading the local config.
        // Force-push (mark dirty first) so the bootstrap actually fires.
        dirtyRef.current = true;
        await syncRefs.current.pushNow();
      }
      // Run the file-binary upload last so the lighter config sync is
      // already mirrored before we start moving megabytes. The HEAD probe
      // inside makes this near-free for already-synced books.
      await syncRefs.current.pushBookFileNow();
    })();
  }, [isReady, progress?.location]);

  // Auto-push on progress changes. The debounce holds the network call
  // off until the user has stopped turning pages for PUSH_DEBOUNCE_MS,
  // and the dirty check inside debouncedPush short-circuits no-op flushes.
  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    markDirtyAndSchedule();
  }, [isReady, progress?.location, markDirtyAndSchedule]);

  // Booknote mutations: hash on length + max(updatedAt, deletedAt) so a
  // pure re-render that produces a fresh `booknotes` array reference
  // without any real change doesn't fire a push. The hash is cheap
  // enough to recompute every render and keeps the effect dependency
  // primitive.
  const config = getConfig(bookKey);
  const booknoteFingerprint = useMemo(() => {
    const notes = config?.booknotes ?? [];
    let max = 0;
    for (const n of notes) {
      const t = Math.max(n.updatedAt ?? 0, n.deletedAt ?? 0);
      if (t > max) max = t;
    }
    return `${notes.length}:${max}`;
  }, [config?.booknotes]);
  useEffect(() => {
    if (!isReady) return;
    // The very first render after a pull populates the booknotes; we
    // shouldn't treat that as a local edit. lastPulledAtRef being recent
    // is a sufficient proxy.
    if (Date.now() - lastPulledAtRef.current < 1_000) return;
    markDirtyAndSchedule();
  }, [isReady, booknoteFingerprint, markDirtyAndSchedule]);

  // Manual triggers: settings UI dispatches these via "Sync now" buttons,
  // and the reader emits flush-webdav-sync on close so we don't lose the
  // last few seconds of reading progress.
  useEffect(() => {
    const handlePush = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      // User-triggered push is unconditional — flip dirty so the flush
      // actually does something, and re-run the book-file upload check
      // so a freshly-toggled "Sync Book Files" picks up the binary.
      dirtyRef.current = true;
      fileSyncedRef.current = false;
      debouncedPush.flush();
      syncRefs.current.pushBookFileNow();
    };
    const handlePull = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      lastPulledAtRef.current = 0; // bypass cooldown for explicit pulls
      hasPulledOnce.current = false;
      syncRefs.current.pullNow();
    };
    eventDispatcher.on('push-webdav-sync', handlePush);
    eventDispatcher.on('pull-webdav-sync', handlePull);
    eventDispatcher.on('flush-webdav-sync', handlePush);
    return () => {
      eventDispatcher.off('push-webdav-sync', handlePush);
      eventDispatcher.off('pull-webdav-sync', handlePull);
      eventDispatcher.off('flush-webdav-sync', handlePush);
    };
  }, [bookKey, debouncedPush]);

  // Window blur ⇒ push pending changes if any. Window focus ⇒ pull, but
  // only if we haven't pulled within PULL_COOLDOWN_MS — important on
  // mobile where alt-tab equivalents (notifications, app switch) can
  // fire many times per minute.
  useWindowActiveChanged((isActive) => {
    if (!isReady) return;
    if (isActive) {
      if (Date.now() - lastPulledAtRef.current < PULL_COOLDOWN_MS) return;
      syncRefs.current.pullNow();
    } else if (dirtyRef.current) {
      debouncedPush.flush();
    }
  });

  // Flush any pending debounced push when the hook unmounts (book closed,
  // user navigated away). Without this, a quick read-then-close session
  // can lose its tail-end progress because the debounce timer never
  // fires. The dirty check inside debouncedPush keeps no-op flushes out
  // of the wire.
  useEffect(() => {
    return () => {
      debouncedPush.flush();
    };
  }, [debouncedPush]);

  return { pushNow, pullNow };
};

export default useWebDAVSync;
