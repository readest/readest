import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import type { BookNote } from '@/types/book';
import { FileSyncEngine } from '@/services/sync/file/engine';
import { FileSyncError } from '@/services/sync/file/provider';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import {
  createFileSyncProvider,
  type FileSyncBackendKind,
} from '@/services/sync/file/providerRegistry';
import { canBackendRun } from '@/services/sync/file/runLibrarySync';
import {
  getActiveFileSyncBackends,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';
import { removeBookNoteOverlays } from '../utils/annotatorUtil';
import { useWindowActiveChanged } from './useWindowActiveChanged';

/**
 * Per-book file-sync hook — drives EVERY enabled third-party backend at once.
 *
 * Cloud sync providers are independently selectable (#5062): several
 * third-party backends (WebDAV, Google Drive, S3, OneDrive) can mirror a
 * book's progress and annotations in parallel, alongside (or instead of)
 * Readest Cloud, whose native progress sync is `useProgressSync`'s job, not
 * this hook's, and runs independently.
 *
 * The hook is called exactly once per book (React forbids a variable hook
 * count), so every scalar the single-backend version used to hold —
 * `activeKind`, `providerSettings`, `engineKey`, `isReady`, `allowPush` /
 * `allowPull`, and the per-book locks (`fileSyncedRef`, `coverSyncedRef`) —
 * is a per-backend collection here, and the four sync operations (push
 * config, pull config, push book file, push cover) loop over the enabled
 * backends instead of touching one.
 *
 * Failure isolation: one backend throwing must not stop the others from
 * pushing or pulling — redundancy is worthless if a dead mirror takes the
 * live one down with it. Every per-backend operation is wrapped in its own
 * try/catch.
 *
 * Merge chaining (the subtle part): `engine.pullBookConfig(book, config)`
 * merges `config` with that backend's remote and returns the merged result.
 * Pulling from several backends CHAINS — backend 2 must merge on top of the
 * config backend 1 already merged, so the final config reflects every
 * mirror. Pulling all of them against the ORIGINAL local config and keeping
 * one result would silently drop whichever mirror lost the race.
 *
 * Energy budget — these constants are deliberately tuned for mobile:
 *   - Push debounce: 15 s. Real reading sessions involve continuous page-turns,
 *     so a longer window collapses many turns into one PUT.
 *   - Pull cooldown: 60 s. Window focus shouldn't trigger a fresh fetch on every
 *     alt-tab; once a minute is plenty for cross-device drift.
 *   - Open-pull skip: 30 s. Quickly closing/reopening a book shouldn't re-fetch
 *     the same config that's already current in memory.
 *
 * Strategy semantics — same vocabulary as KOSync, evaluated per backend:
 *   - 'silent' (default): always push and always pull, latest writer wins
 *   - 'send':   push only, never pull (this device feeds others)
 *   - 'receive': pull only, never push (this device follows others)
 *   - 'prompt': not implemented — falls back to 'silent'
 */

/** Debounce window for auto-push triggered by progress / booknote churn. */
const PUSH_DEBOUNCE_MS = 15_000;
/** Minimum gap between automatic pulls (e.g. window-focus, open-book). */
const PULL_COOLDOWN_MS = 60_000;
/**
 * If this hook ran a successful pull less than this long ago for the current
 * book, skip the open-book pull entirely. `lastPulledAtRef` is instance state,
 * so close-then-reopen resets it; the skip only fires on re-runs within one hook
 * lifetime (navigating between books, or progress arriving in two ticks).
 */
const OPEN_PULL_SKIP_MS = 30_000;

/**
 * Whether a pull actually landed a remote reading position: the merged
 * location exists and differs from what this device already had. Drives the
 * same top-right "Reading Progress Synced" hint the native cloud sync shows,
 * so WebDAV / Google Drive give equal feedback.
 */
export const remoteProgressApplied = (
  localLocation: string | null | undefined,
  mergedLocation: string | null | undefined,
): boolean => !!mergedLocation && mergedLocation !== localLocation;

export const useFileSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const getViewsById = useReaderStore((s) => s.getViewsById);
  const getView = useReaderStore((s) => s.getView);
  const getConfig = useBookDataStore((s) => s.getConfig);
  const setConfig = useBookDataStore((s) => s.setConfig);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const saveConfig = useBookDataStore((s) => s.saveConfig);
  // Reactive: triggers the auto-push effect on page turns.
  const progress = useBookProgress(bookKey);

  const { userProfilePlan } = useQuotaStats();
  // Every enabled third-party backend syncs this book in parallel (#5062);
  // Readest Cloud's native progress sync is useProgressSync's job, not this
  // hook's, and runs independently.
  const activeKinds = useMemo(
    () => getActiveFileSyncBackends(settings, userProfilePlan ?? 'free'),
    [settings, userProfilePlan],
  );

  /** Flips true on the first local change after a push, false right before each push. */
  const dirtyRef = useRef(false);
  /** Last successful pull timestamp; gates window-focus and open-book pulls. */
  const lastPulledAtRef = useRef(0);
  const hasPulledOnce = useRef(false);
  /** Backends whose book binary this instance already pushed. */
  const fileSyncedRef = useRef(new Set<FileSyncBackendKind>());
  /** Backends whose cover this instance already pushed. */
  const coverSyncedRef = useRef(new Set<FileSyncBackendKind>());
  /**
   * One-shot guard PER BACKEND so an expired session toasts once, not on
   * every page-turn — a `Set` rather than a single boolean, because one
   * backend can be healthy while a sibling's session is expired, and each
   * must be notified (and re-armed) independently.
   */
  const authNotifiedRef = useRef(new Set<FileSyncBackendKind>());

  // Switching the enabled backend SET mid-session resets the per-book locks so
  // newly-active backends do a fresh pull-on-open and re-check file/cover.
  const activeKindsKey = activeKinds.join(',');
  useEffect(() => {
    hasPulledOnce.current = false;
    fileSyncedRef.current.clear();
    coverSyncedRef.current.clear();
    lastPulledAtRef.current = 0;
    dirtyRef.current = false;
    authNotifiedRef.current.clear();
  }, [activeKindsKey]);

  // Per-backend settings slice + strategy helpers, replacing the old single
  // `providerSettings` / `allowPush` / `allowPull`.
  const sliceFor = useCallback(
    (kind: FileSyncBackendKind) => settings[settingsKeyForBackend(kind)],
    [settings],
  );
  const allowsPush = useCallback(
    (kind: FileSyncBackendKind) => (sliceFor(kind)?.strategy ?? 'silent') !== 'receive',
    [sliceFor],
  );
  const allowsPull = useCallback(
    (kind: FileSyncBackendKind) => (sliceFor(kind)?.strategy ?? 'silent') !== 'send',
    [sliceFor],
  );

  // Read latest settings from the store (not the closure) when patching a
  // backend's slice: pull → push can fire back-to-back when a book opens, and
  // a closure-based merge could clobber a sibling write.
  const ensureDeviceId = useCallback(
    (kind: FileSyncBackendKind): string => {
      const latest = useSettingsStore.getState().settings;
      const key = settingsKeyForBackend(kind);
      let id = latest[key]?.deviceId;
      if (!id) {
        id = uuidv4();
        const next = { ...latest, [key]: { ...latest[key], deviceId: id } };
        setSettings(next);
        saveSettings(envConfig, next);
      }
      return id;
    },
    [envConfig, setSettings, saveSettings],
  );

  /**
   * Stamp `lastSyncedAt` for every kind in `kinds` in ONE settings write —
   * looping backends through the single-kind version would persist the whole
   * settings file once per backend, and with 4 enabled backends that is 4
   * full writes per push cycle (every `PUSH_DEBOUNCE_MS` while reading) where
   * the single-backend original did 1. Reads the latest settings from the
   * store (not a closure) because pull and push can fire back-to-back on
   * book open, and a closure-based merge would clobber a sibling write.
   */
  const updateLastSyncedAt = useCallback(
    async (kinds: FileSyncBackendKind[], ts: number) => {
      if (kinds.length === 0) return;
      let next = useSettingsStore.getState().settings;
      for (const kind of kinds) {
        // A switch (rather than a generically-keyed write) keeps each
        // branch's settings slice type intact; `next[key] = { ...slice, ts }`
        // does not typecheck when `key` is a union of literal keys.
        switch (kind) {
          case 'webdav':
            next = { ...next, webdav: { ...next.webdav, lastSyncedAt: ts } };
            break;
          case 'gdrive':
            next = { ...next, googleDrive: { ...next.googleDrive, lastSyncedAt: ts } };
            break;
          case 's3':
            next = { ...next, s3: { ...next.s3, lastSyncedAt: ts } };
            break;
          case 'onedrive':
            next = { ...next, onedrive: { ...next.onedrive, lastSyncedAt: ts } };
            break;
        }
      }
      setSettings(next);
      await saveSettings(envConfig, next);
    },
    [envConfig, setSettings, saveSettings],
  );

  // The engine list is built asynchronously: Google Drive probes the OS
  // keychain to assemble its token store. Keyed on the connection-relevant
  // settings (not the whole settings object) so a `lastSyncedAt` write doesn't
  // rebuild it — which for Drive would re-probe the keychain on every push.
  const engineKey = useMemo(() => {
    const w = settings.webdav;
    const c = settings.s3;
    return [
      activeKindsKey,
      `webdav:${w?.serverUrl}:${w?.username}:${w?.password}:${w?.rootPath}`,
      `gdrive:${settings.googleDrive?.enabled}`,
      `s3:${c?.endpoint}:${c?.region}:${c?.bucket}:${c?.accessKeyId}:${c?.secretAccessKey}`,
      `onedrive:${settings.onedrive?.enabled}`,
    ].join('|');
  }, [activeKindsKey, settings.webdav, settings.googleDrive, settings.s3, settings.onedrive]);

  const [engines, setEngines] = useState<
    Array<{ kind: FileSyncBackendKind; engine: FileSyncEngine }>
  >([]);
  useEffect(() => {
    let cancelled = false;
    setEngines([]);
    if (!appService || activeKinds.length === 0) return;
    (async () => {
      const current = useSettingsStore.getState().settings;
      const built: Array<{ kind: FileSyncBackendKind; engine: FileSyncEngine }> = [];
      for (const kind of activeKinds) {
        // Same transport gate the library pass uses — an expired web Drive token
        // would otherwise abort every push and pull with a terminal AUTH_FAILED.
        if (!canBackendRun(kind)) continue;
        const provider = await createFileSyncProvider(kind, current);
        if (!provider) continue;
        const store = createAppLocalStore({ appService, settings: current, envConfig });
        built.push({ kind, engine: new FileSyncEngine(provider, store) });
      }
      if (!cancelled) setEngines(built);
    })();
    return () => {
      cancelled = true;
    };
    // `engineKey` captures the connection-relevant settings; the rest is read
    // fresh inside the effect so unrelated settings writes don't rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineKey, appService, envConfig]);

  const isReady = engines.length > 0;

  /**
   * Notify (once) that a backend's session expired so the user knows to
   * reconnect — a single top-right reader `hint` (same affordance as the
   * native "Reading Progress Synced" hint), NOT a per-failure error toast.
   * Reset on a successful sync / backend-set change.
   */
  const notifyAuthExpiredOnce = useCallback(
    (kind: FileSyncBackendKind) => {
      if (authNotifiedRef.current.has(kind)) return;
      authNotifiedRef.current.add(kind);
      eventDispatcher.dispatch('hint', {
        bookKey,
        timeout: 5000,
        message:
          kind === 'gdrive' ? _('Google Drive session expired') : _('Cloud sync session expired'),
      });
    },
    [bookKey, _],
  );

  /** Map a sync error: surface an expired session once, log everything. */
  const handleSyncError = useCallback(
    (kind: FileSyncBackendKind, label: string, e: unknown) => {
      if (e instanceof FileSyncError && e.code === 'AUTH_FAILED') notifyAuthExpiredOnce(kind);
      console.warn(label, kind, e);
    },
    [notifyAuthExpiredOnce],
  );

  /**
   * Push the latest config (progress + booknotes) to every backend that
   * allows it. One backend failing must not stop the others.
   */
  const pushNow = useCallback(async () => {
    if (!isReady) return;
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return;

    const pushedKinds: FileSyncBackendKind[] = [];
    for (const { kind, engine } of engines) {
      if (!allowsPush(kind)) continue;
      const ps = sliceFor(kind);
      const wantProgress = ps?.syncProgress ?? true;
      const wantNotes = ps?.syncNotes ?? true;
      if (!wantProgress && !wantNotes) continue;
      try {
        await engine.pushBookConfig(book, config, ensureDeviceId(kind));
        // This backend's session is proven live — clear its own expired-auth
        // notice without touching a sibling's (still-expired) one.
        authNotifiedRef.current.delete(kind);
        pushedKinds.push(kind);
      } catch (e) {
        handleSyncError(kind, 'file sync push failed', e);
      }
    }
    if (pushedKinds.length > 0) {
      dirtyRef.current = false;
      await updateLastSyncedAt(pushedKinds, Date.now());
    }
  }, [
    isReady,
    bookKey,
    engines,
    getConfig,
    getBookData,
    allowsPush,
    sliceFor,
    ensureDeviceId,
    updateLastSyncedAt,
    handleSyncError,
  ]);

  /**
   * Upload the book binary to every backend with syncBooks on. Cheap on the
   * steady state (a single HEAD per book per backend per session); re-runs
   * within the same instance no-op via `fileSyncedRef`.
   */
  const pushBookFileNow = useCallback(async () => {
    if (!isReady) return;
    const book = getBookData(bookKey)?.book;
    if (!book) return;
    const uploadedKinds: FileSyncBackendKind[] = [];
    for (const { kind, engine } of engines) {
      if (!allowsPush(kind)) continue;
      if (!(sliceFor(kind)?.syncBooks ?? false)) continue;
      if (fileSyncedRef.current.has(kind)) continue;
      fileSyncedRef.current.add(kind);
      try {
        const result = await engine.pushBookFile(book);
        if (result.uploaded) uploadedKinds.push(kind);
      } catch (e) {
        // Reset this backend's lock so a later trigger retries it.
        fileSyncedRef.current.delete(kind);
        handleSyncError(kind, 'file sync book push failed', e);
      }
    }
    if (uploadedKinds.length > 0) await updateLastSyncedAt(uploadedKinds, Date.now());
  }, [
    isReady,
    engines,
    bookKey,
    getBookData,
    allowsPush,
    sliceFor,
    updateLastSyncedAt,
    handleSyncError,
  ]);

  /**
   * Push the local cover image to every backend, independent of `syncBooks` —
   * covers are part of the book's metadata and the receiving device can't
   * regenerate them without the book bytes. Best-effort: a missing local
   * cover silently no-ops.
   */
  const pushBookCoverNow = useCallback(async () => {
    if (!isReady) return;
    const book = getBookData(bookKey)?.book;
    if (!book) return;
    for (const { kind, engine } of engines) {
      if (!allowsPush(kind)) continue;
      if (coverSyncedRef.current.has(kind)) continue;
      coverSyncedRef.current.add(kind);
      try {
        await engine.pushBookCover(book);
      } catch (e) {
        coverSyncedRef.current.delete(kind);
        handleSyncError(kind, 'file sync cover push failed', e);
      }
    }
  }, [isReady, engines, bookKey, getBookData, allowsPush, handleSyncError]);

  /**
   * Pull, merge, and persist from every backend that allows it, CHAINING the
   * merges: each backend merges on top of the config the previous backend
   * already merged, so the final config reflects every mirror. Pulling all of
   * them against the ORIGINAL local config and keeping one result would
   * silently drop whichever mirror lost the race. Returns `true` when at
   * least one backend had a payload to merge.
   *
   * Sub-toggle masking happens INSIDE the loop, per backend: `pullBookConfig`
   * merges a backend's WHOLE remote into `working` regardless of that
   * backend's own `syncProgress` / `syncNotes` toggles, so a backend that
   * opted out of a field must have that field reverted to its pre-merge value
   * right after its own merge — otherwise its remote data for an opted-out
   * field rides in on a sibling backend's opt-in (a union computed once at
   * the end would let exactly that happen).
   */
  const pullNow = useCallback(async (): Promise<boolean> => {
    if (!isReady) return false;
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return false;

    let working = config;
    let applied = false;
    let mergedNotes: BookNote[] | undefined;
    const pulledKinds: FileSyncBackendKind[] = [];

    for (const { kind, engine } of engines) {
      if (!allowsPull(kind)) continue;
      const ps = sliceFor(kind);
      const wantProgress = ps?.syncProgress ?? true;
      const wantNotes = ps?.syncNotes ?? true;
      if (!wantProgress && !wantNotes) continue;
      const before = working;
      try {
        const result = await engine.pullBookConfig(book, working);
        lastPulledAtRef.current = Date.now();
        // This backend's getAccessToken succeeded — clear its own
        // expired-session notice without touching a sibling's.
        authNotifiedRef.current.delete(kind);
        pulledKinds.push(kind);
        if (!result.applied || !result.mergedConfig) continue;
        applied = true;
        let merged = result.mergedConfig;
        // Revert the fields this backend opted out of back to their
        // pre-merge value, so its remote data for them never enters `working`.
        if (!wantProgress) {
          merged = {
            ...merged,
            progress: before.progress,
            location: before.location,
            xpointer: before.xpointer,
          };
        }
        if (!wantNotes) {
          merged = { ...merged, booknotes: before.booknotes };
        } else if (result.mergedNotes) {
          mergedNotes = result.mergedNotes;
        }
        working = merged;
      } catch (e) {
        handleSyncError(kind, 'file sync pull failed', e);
      }
    }

    if (pulledKinds.length > 0) await updateLastSyncedAt(pulledKinds, Date.now());
    if (!applied) return false;

    // Surface merged notes through the live view so highlights re-appear /
    // disappear without waiting for the next render pass. `mergedNotes` is
    // only ever set from a backend that wanted notes, so this already
    // reflects the notes that actually landed in `working`.
    if (mergedNotes) {
      const view = getView(bookKey);
      const previousById = new Map((config.booknotes ?? []).map((n) => [n.id, n]));
      for (const note of mergedNotes) {
        const prev = previousById.get(note.id);
        if (note.deletedAt && (!prev || !prev.deletedAt)) {
          getViewsById(bookKey.split('-')[0]!).forEach((v) => removeBookNoteOverlays(v, note));
        } else if (!note.deletedAt && note.cfi && view) {
          try {
            view.addAnnotation(note);
          } catch {
            // The annotation may not belong to the current spine index.
          }
        }
      }
    }

    setConfig(bookKey, working);
    // Parity with the native cloud sync: surface the same top-right hint when a
    // remote reading position was fetched and applied. `working` is already
    // masked per backend, so this is false when every pulling backend opted
    // out of progress.
    if (remoteProgressApplied(config.location, working.location)) {
      eventDispatcher.dispatch('hint', {
        bookKey,
        message: _('Reading Progress Synced'),
      });
    }
    const latest = getConfig(bookKey);
    if (latest) await saveConfig(envConfig, bookKey, latest, settings);
    return true;
  }, [
    isReady,
    bookKey,
    engines,
    getConfig,
    getBookData,
    getView,
    getViewsById,
    setConfig,
    saveConfig,
    allowsPull,
    sliceFor,
    updateLastSyncedAt,
    envConfig,
    settings,
    handleSyncError,
    _,
  ]);

  // Stash the latest callbacks in a ref so the event-bridge effect doesn't
  // re-bind on every render (pattern from useKOSync).
  const syncRefs = useRef({ pushNow, pullNow, pushBookFileNow, pushBookCoverNow });
  useEffect(() => {
    syncRefs.current = { pushNow, pullNow, pushBookFileNow, pushBookCoverNow };
  }, [pushNow, pullNow, pushBookFileNow, pushBookCoverNow]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedPush = useCallback(
    debounce(() => {
      if (!dirtyRef.current) return;
      syncRefs.current.pushNow();
    }, PUSH_DEBOUNCE_MS),
    [],
  );

  const markDirtyAndSchedule = useCallback(() => {
    dirtyRef.current = true;
    debouncedPush();
  }, [debouncedPush]);

  // Pull once on book open (waiting for a known location), then push if the
  // remote was empty so the per-book directory is created on first use. The
  // book-file/cover uploads ride along on the same trigger.
  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    if (hasPulledOnce.current) return;
    hasPulledOnce.current = true;
    if (Date.now() - lastPulledAtRef.current < OPEN_PULL_SKIP_MS) return;
    (async () => {
      const merged = await syncRefs.current.pullNow();
      if (!merged) {
        dirtyRef.current = true;
        await syncRefs.current.pushNow();
      }
      await Promise.all([syncRefs.current.pushBookCoverNow(), syncRefs.current.pushBookFileNow()]);
    })();
  }, [isReady, progress?.location]);

  // Auto-push on progress changes (debounced; the dirty check short-circuits).
  useEffect(() => {
    if (!isReady) return;
    if (!progress?.location) return;
    markDirtyAndSchedule();
  }, [isReady, progress?.location, markDirtyAndSchedule]);

  // Booknote mutations: hash on length + max(updatedAt, deletedAt) so a pure
  // re-render with a fresh array reference doesn't fire a push.
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
    // The first render after a pull populates booknotes; don't treat as an edit.
    if (Date.now() - lastPulledAtRef.current < 1_000) return;
    markDirtyAndSchedule();
  }, [isReady, booknoteFingerprint, markDirtyAndSchedule]);

  // Manual triggers: settings UI / reader-close can dispatch these.
  useEffect(() => {
    const handlePush = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      dirtyRef.current = true;
      fileSyncedRef.current.clear();
      coverSyncedRef.current.clear();
      debouncedPush.flush();
      syncRefs.current.pushBookFileNow();
      syncRefs.current.pushBookCoverNow();
    };
    const handlePull = (event: CustomEvent) => {
      if (event.detail?.bookKey && event.detail.bookKey !== bookKey) return;
      lastPulledAtRef.current = 0;
      hasPulledOnce.current = false;
      syncRefs.current.pullNow();
    };
    eventDispatcher.on('push-file-sync', handlePush);
    eventDispatcher.on('pull-file-sync', handlePull);
    eventDispatcher.on('flush-file-sync', handlePush);
    return () => {
      eventDispatcher.off('push-file-sync', handlePush);
      eventDispatcher.off('pull-file-sync', handlePull);
      eventDispatcher.off('flush-file-sync', handlePush);
    };
  }, [bookKey, debouncedPush]);

  // Window blur ⇒ push pending changes. Window focus ⇒ pull (cooldown-gated).
  useWindowActiveChanged((isActive) => {
    if (!isReady) return;
    if (isActive) {
      if (Date.now() - lastPulledAtRef.current < PULL_COOLDOWN_MS) return;
      syncRefs.current.pullNow();
    } else if (dirtyRef.current) {
      debouncedPush.flush();
    }
  });

  // Flush any pending debounced push when the hook unmounts (book closed).
  useEffect(() => {
    return () => {
      debouncedPush.flush();
    };
  }, [debouncedPush]);

  return { pushNow, pullNow, pushBookFileNow, pushBookCoverNow };
};

export default useFileSync;
