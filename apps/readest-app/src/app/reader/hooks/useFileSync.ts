import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { isCloudSyncAllowed } from '@/utils/access';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { FileSyncEngine } from '@/services/sync/file/engine';
import { FileSyncError } from '@/services/sync/file/provider';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import {
  createFileSyncProvider,
  type FileSyncBackendKind,
} from '@/services/sync/file/providerRegistry';
import { removeBookNoteOverlays } from '../utils/annotatorUtil';
import { useWindowActiveChanged } from './useWindowActiveChanged';

/**
 * Per-book file-sync hook for the active third-party cloud provider.
 *
 * The third-party cloud providers (WebDAV, Google Drive) are mutually exclusive
 * — only one is enabled at a time (see the Cloud Sync settings page) — so this
 * hook drives exactly that one active backend, built through the provider
 * registry. Same architecture as `useKOSync` / `useProgressSync`: pull-once on
 * book open, debounced push on progress / booknote changes, manual flush on the
 * `flush-file-sync` event.
 *
 * Energy budget — these constants are deliberately tuned for mobile:
 *   - Push debounce: 15 s. Real reading sessions involve continuous page-turns,
 *     so a longer window collapses many turns into one PUT.
 *   - Pull cooldown: 60 s. Window focus shouldn't trigger a fresh fetch on every
 *     alt-tab; once a minute is plenty for cross-device drift.
 *   - Open-pull skip: 30 s. Quickly closing/reopening a book shouldn't re-fetch
 *     the same config that's already current in memory.
 *
 * Gating: the active provider's `enabled` master switch, plus WebDAV's
 * serverUrl/username (the Connect flow guarantees these). Google Drive's token
 * lives in the OS keychain, so `enabled` is the only settings gate there.
 *
 * Strategy semantics — same vocabulary as KOSync:
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

/** Settings key for a backend kind. */
const settingsKeyFor = (kind: FileSyncBackendKind): 'webdav' | 'googleDrive' =>
  kind === 'gdrive' ? 'googleDrive' : 'webdav';

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

  // The single active cloud provider (WebDAV and Google Drive are exclusive).
  const activeKind: FileSyncBackendKind | null = settings.webdav?.enabled
    ? 'webdav'
    : settings.googleDrive?.enabled
      ? 'gdrive'
      : null;
  const providerSettings = activeKind === 'gdrive' ? settings.googleDrive : settings.webdav;

  /** Flips true on the first local change after a push, false right before each push. */
  const dirtyRef = useRef(false);
  /** Last successful pull timestamp; gates window-focus and open-book pulls. */
  const lastPulledAtRef = useRef(0);
  const hasPulledOnce = useRef(false);
  /** Per-instance lock for the book-file uploader (hash-keyed content). */
  const fileSyncedRef = useRef(false);
  /** Per-instance lock for the cover uploader (gated differently than files). */
  const coverSyncedRef = useRef(false);
  /** One-shot guard so an expired session toasts once, not on every page-turn. */
  const authNotifiedRef = useRef(false);

  // Switching the active provider mid-session resets the per-book locks so the
  // newly-active backend does a fresh pull-on-open and re-checks file/cover.
  useEffect(() => {
    hasPulledOnce.current = false;
    fileSyncedRef.current = false;
    coverSyncedRef.current = false;
    lastPulledAtRef.current = 0;
    dirtyRef.current = false;
    authNotifiedRef.current = false;
  }, [activeKind]);

  // Read latest settings from the store (not the closure) when patching the
  // active provider's slice: pull → push can fire back-to-back when a book
  // opens, and a closure-based merge could clobber a sibling write.
  const ensureDeviceId = useCallback((): string => {
    const latest = useSettingsStore.getState().settings;
    const key = activeKind ? settingsKeyFor(activeKind) : 'webdav';
    let id = latest[key]?.deviceId;
    if (!id) {
      id = uuidv4();
      const next = { ...latest, [key]: { ...latest[key], deviceId: id } };
      setSettings(next);
      saveSettings(envConfig, next);
    }
    return id;
  }, [activeKind, envConfig, setSettings, saveSettings]);

  const updateLastSyncedAt = useCallback(
    async (ts: number) => {
      const latest = useSettingsStore.getState().settings;
      const key = activeKind ? settingsKeyFor(activeKind) : 'webdav';
      const next = { ...latest, [key]: { ...latest[key], lastSyncedAt: ts } };
      setSettings(next);
      await saveSettings(envConfig, next);
    },
    [activeKind, envConfig, setSettings, saveSettings],
  );

  // Third-party cloud sync will be a premium feature (the reader's auto-sync
  // would stay off for free plans), but it is temporarily UNGATED while the
  // feature stabilises — `isCloudSyncAllowed` returns true for every plan until
  // `CLOUD_SYNC_REQUIRES_PREMIUM` is flipped back on.
  const { userProfilePlan } = useQuotaStats();
  const isPremium = isCloudSyncAllowed(userProfilePlan ?? 'free');

  const isReady = useMemo(() => {
    if (!isPremium) return false;
    if (activeKind === 'webdav') {
      const w = settings.webdav;
      return !!(w?.enabled && w?.serverUrl && w?.username);
    }
    if (activeKind === 'gdrive') return !!settings.googleDrive?.enabled;
    return false;
  }, [isPremium, activeKind, settings.webdav, settings.googleDrive]);

  const strategy = providerSettings?.strategy ?? 'silent';
  const allowPush = isReady && strategy !== 'receive';
  const allowPull = isReady && strategy !== 'send';

  // The engine is built asynchronously: the Google Drive provider probes the OS
  // keychain to assemble its token store. Keyed on the connection-relevant
  // settings (not the whole settings object) so a `lastSyncedAt` write doesn't
  // rebuild it — which for Drive would re-probe the keychain on every push.
  const engineKey = useMemo(() => {
    if (activeKind === 'webdav') {
      const w = settings.webdav;
      return `webdav:${w?.enabled}:${w?.serverUrl}:${w?.username}:${w?.password}:${w?.rootPath}`;
    }
    if (activeKind === 'gdrive') return `gdrive:${settings.googleDrive?.enabled}`;
    return 'none';
  }, [activeKind, settings.webdav, settings.googleDrive]);

  const [engine, setEngine] = useState<FileSyncEngine | null>(null);
  useEffect(() => {
    let cancelled = false;
    setEngine(null);
    if (!isReady || !appService || activeKind === null) return;
    (async () => {
      const current = useSettingsStore.getState().settings;
      const provider = await createFileSyncProvider(activeKind, current);
      if (cancelled || !provider) return;
      const store = createAppLocalStore({ appService, settings: current, envConfig });
      setEngine(new FileSyncEngine(provider, store));
    })();
    return () => {
      cancelled = true;
    };
    // `engineKey` captures the connection-relevant settings; the rest is read
    // fresh inside the effect so unrelated settings writes don't rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineKey, isReady, activeKind, appService, envConfig]);

  /**
   * Notify (once) that the active provider's session expired so the user knows
   * to reconnect — a single top-right reader `hint` (same affordance as the
   * native "Reading Progress Synced" hint), NOT a per-failure error toast. Reset
   * on a successful sync / provider switch.
   */
  const notifyAuthExpiredOnce = useCallback(() => {
    if (authNotifiedRef.current) return;
    authNotifiedRef.current = true;
    eventDispatcher.dispatch('hint', {
      bookKey,
      timeout: 5000,
      message:
        activeKind === 'gdrive'
          ? _('Google Drive session expired. Reconnect in Settings.')
          : _('Cloud sync session expired. Reconnect in Settings.'),
    });
  }, [bookKey, activeKind, _]);

  /** Map a sync error: surface an expired session once, log everything. */
  const handleSyncError = useCallback(
    (label: string, e: unknown) => {
      if (e instanceof FileSyncError && e.code === 'AUTH_FAILED') notifyAuthExpiredOnce();
      console.warn(label, e);
    },
    [notifyAuthExpiredOnce],
  );

  /**
   * Push the latest config (progress + booknotes) to the remote. Skips while the
   * user is previewing a deep-link target — that in-memory position reflects the
   * annotation, not actual reading.
   */
  const pushNow = useCallback(async () => {
    if (!allowPush) return;
    if (useReaderStore.getState().getViewState(bookKey)?.previewMode) return;
    const wantProgress = providerSettings?.syncProgress ?? true;
    const wantNotes = providerSettings?.syncNotes ?? true;
    if (!wantProgress && !wantNotes) return;

    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book || !engine) return;

    try {
      const deviceId = ensureDeviceId();
      await engine.pushBookConfig(book, config, deviceId);
      dirtyRef.current = false;
      authNotifiedRef.current = false;
      await updateLastSyncedAt(Date.now());
    } catch (e) {
      handleSyncError('file sync push failed', e);
    }
  }, [
    allowPush,
    bookKey,
    getConfig,
    getBookData,
    ensureDeviceId,
    engine,
    providerSettings,
    updateLastSyncedAt,
    handleSyncError,
  ]);

  /**
   * Upload the book binary if syncBooks is on and the remote doesn't already
   * have a same-sized copy. Cheap on the steady state (a single HEAD per book
   * per session); re-runs within the same instance no-op via `fileSyncedRef`.
   */
  const pushBookFileNow = useCallback(async () => {
    if (!allowPush) return;
    if (!(providerSettings?.syncBooks ?? false)) return;
    if (fileSyncedRef.current) return;
    fileSyncedRef.current = true;

    const book = getBookData(bookKey)?.book;
    if (!book || !engine) return;

    try {
      const result = await engine.pushBookFile(book);
      if (result.uploaded) await updateLastSyncedAt(Date.now());
    } catch (e) {
      // Reset the lock on failure so a later trigger retries.
      fileSyncedRef.current = false;
      handleSyncError('file sync book push failed', e);
    }
  }, [
    allowPush,
    providerSettings,
    getBookData,
    bookKey,
    engine,
    updateLastSyncedAt,
    handleSyncError,
  ]);

  /**
   * Push the local cover image, independent of `syncBooks` — covers are part of
   * the book's metadata and the receiving device can't regenerate them without
   * the book bytes. Best-effort: a missing local cover silently no-ops.
   */
  const pushBookCoverNow = useCallback(async () => {
    if (!allowPush) return;
    if (coverSyncedRef.current) return;
    coverSyncedRef.current = true;

    const book = getBookData(bookKey)?.book;
    if (!book || !engine) return;

    try {
      await engine.pushBookCover(book);
    } catch (e) {
      coverSyncedRef.current = false;
      handleSyncError('file sync cover push failed', e);
    }
  }, [allowPush, getBookData, bookKey, engine, handleSyncError]);

  /**
   * Pull, merge, and persist, using the same per-config / per-note merge as the
   * native cloud sync. Returns `true` when the remote had a payload (merge
   * happened), `false` when empty — callers use that to bootstrap an initial push.
   */
  const pullNow = useCallback(async (): Promise<boolean> => {
    if (!allowPull) return false;
    const wantProgress = providerSettings?.syncProgress ?? true;
    const wantNotes = providerSettings?.syncNotes ?? true;
    if (!wantProgress && !wantNotes) return false;

    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book || !engine) return false;

    try {
      const result = await engine.pullBookConfig(book, config);
      lastPulledAtRef.current = Date.now();
      // The pull's getAccessToken succeeded — clear any expired-session notice.
      authNotifiedRef.current = false;
      if (!result.applied || !result.mergedConfig) return false;

      // Surface merged notes through the live view so highlights re-appear /
      // disappear without waiting for the next render pass.
      if (wantNotes && result.mergedNotes) {
        const view = getView(bookKey);
        const previousById = new Map((config.booknotes ?? []).map((n) => [n.id, n]));
        for (const note of result.mergedNotes) {
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

      // Honour sub-toggles: drop the parts the user opted out of.
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
      const latest = getConfig(bookKey);
      if (latest) await saveConfig(envConfig, bookKey, latest, settings);
      await updateLastSyncedAt(Date.now());
      return true;
    } catch (e) {
      handleSyncError('file sync pull failed', e);
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
    engine,
    envConfig,
    settings,
    providerSettings,
    updateLastSyncedAt,
    handleSyncError,
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

  // Pull once on book open (waiting for the async engine + a known location),
  // then push if the remote was empty so the per-book directory is created on
  // first use. The book-file/cover uploads ride along on the same trigger.
  useEffect(() => {
    if (!isReady || !engine) return;
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
  }, [isReady, engine, progress?.location]);

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
      fileSyncedRef.current = false;
      coverSyncedRef.current = false;
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

  return { pushNow, pullNow };
};

export default useFileSync;
