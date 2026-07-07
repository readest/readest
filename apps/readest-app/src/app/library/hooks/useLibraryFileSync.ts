import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { isCloudSyncAllowed } from '@/utils/access';
import { isWebAppPlatform } from '@/services/environment';
import { hasValidWebDriveToken } from '@/services/sync/providers/gdrive/auth/webTokenStore';
import { debounce } from '@/utils/debounce';
import { FileSyncEngine } from '@/services/sync/file/engine';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import {
  createFileSyncProvider,
  type FileSyncBackendKind,
} from '@/services/sync/file/providerRegistry';
import { getCloudSyncProvider, settingsKeyForBackend } from '@/services/sync/cloudSyncProvider';

/**
 * Library-scoped auto-sync for the active third-party cloud provider (WebDAV /
 * Google Drive) — the parity counterpart of {@link useBooksSync} (native cloud).
 *
 * The reader's per-book `useFileSync` keeps a book's progress/notes in sync while
 * reading, but never touches the shared `library.json` index. This hook fills
 * that gap: it runs the active provider's `engine.syncLibrary` whenever the
 * library changes — importing, deleting, or closing a book all mutate the
 * library array — so `library.json` (book metadata + tombstones) stays current
 * across devices, exactly as native sync does. Mount once on the library page.
 *
 * Behaviour:
 *   - Debounced to collapse import bursts (and the engine's own
 *     pull-merge writes, which re-fire this effect — debounce + the engine's
 *     incremental cursor make repeats converge to a no-op).
 *   - Gated on the global file-sync mutex so it never collides with a manual
 *     "Sync now" or another backend reconciling the same local library.
 *   - Honours the provider's Sync Strategy (send / receive / silent) and the
 *     "Upload Book Files" toggle, same as the manual sync.
 *   - Passes the FULL library, including soft-deleted books, so deletions
 *     propagate as tombstones in `library.json` and deleted books are not
 *     re-discovered and re-downloaded.
 */

/** Quiet window before an auto library sync fires; collapses import bursts. */
const SYNC_DEBOUNCE_MS = 5_000;

export const useLibraryFileSync = () => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const { setSettings, saveSettings } = useSettingsStore();
  const settings = useSettingsStore((s) => s.settings);
  const library = useLibraryStore((s) => s.library);
  const libraryLoaded = useLibraryStore((s) => s.libraryLoaded);
  const { userProfilePlan } = useQuotaStats();

  // The single active cloud provider (WebDAV and Google Drive are exclusive).
  const provider = getCloudSyncProvider(settings);
  const activeKind: FileSyncBackendKind | null = provider === 'readest' ? null : provider;

  const isAllowed = isCloudSyncAllowed(userProfilePlan ?? 'free');
  const isReady = useMemo(() => {
    if (!isAllowed) return false;
    if (activeKind === 'webdav') {
      const w = settings.webdav;
      return !!(w?.enabled && w?.serverUrl && w?.username);
    }
    if (activeKind === 'gdrive') {
      // Web Drive tokens are session-scoped with no refresh; once expired,
      // every run would abort with AUTH_FAILED on the index pull. Skip the
      // auto-sync until the user reconnects (the Drive settings form shows
      // the Reconnect CTA), mirroring its disabled "Sync now".
      if (isWebAppPlatform() && !hasValidWebDriveToken()) return false;
      return !!settings.googleDrive?.enabled;
    }
    return false;
  }, [isAllowed, activeKind, settings.webdav, settings.googleDrive]);

  // Build the engine async (Drive probes the OS keychain). Keyed on the
  // connection-relevant settings so an unrelated write (e.g. lastSyncedAt)
  // doesn't rebuild it — which for Drive would re-probe the keychain.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engineKey, isReady, activeKind, appService, envConfig]);

  const ensureDeviceId = useCallback((): string => {
    const latest = useSettingsStore.getState().settings;
    const key = activeKind ? settingsKeyForBackend(activeKind) : 'webdav';
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
      const key = activeKind ? settingsKeyForBackend(activeKind) : 'webdav';
      const next = { ...latest, [key]: { ...latest[key], lastSyncedAt: ts } };
      setSettings(next);
      await saveSettings(envConfig, next);
    },
    [activeKind, envConfig, setSettings, saveSettings],
  );

  const runSync = useCallback(async () => {
    if (!engine || activeKind === null || !isReady) return;
    // NEVER sync before the library is loaded from disk: syncing a transient
    // empty library could push an empty index and clobber the remote.
    if (!useLibraryStore.getState().libraryLoaded) return;

    const kind = activeKind;
    const latest = useSettingsStore.getState().settings;
    const ps = latest[settingsKeyForBackend(kind)];
    const strategy = ps?.strategy ?? 'silent';

    const syncStore = useFileSyncStore.getState();
    // Honour the global library-sync mutex: a manual "Sync now" (or another
    // backend) already reconciling the same local library wins; this auto-run
    // skips and the next library change re-triggers it.
    if (!syncStore.beginSync(kind, _('Syncing…'))) return;
    try {
      const books = useLibraryStore.getState().library;
      const deviceId = ensureDeviceId();
      await engine.syncLibrary(books, {
        strategy: strategy === 'prompt' ? 'silent' : strategy,
        syncBooks: ps?.syncBooks ?? false,
        fullSync: false,
        deviceId,
        onProgress: ({ index, total, action }) => {
          const label = action === 'downloading' ? _('Downloading') : _('Uploading');
          useFileSyncStore
            .getState()
            .updateProgress(
              kind,
              _('{{action}} {{n}} / {{total}}', { action: label, n: index + 1, total }),
            );
        },
      });
      await updateLastSyncedAt(Date.now());
      useFileSyncStore.getState().setLastError(kind, null);
    } catch (e) {
      useFileSyncStore.getState().setLastError(kind, e instanceof Error ? e.message : String(e));
      console.warn('library file sync failed', e);
    } finally {
      useFileSyncStore.getState().endSync(kind);
    }
  }, [engine, activeKind, isReady, ensureDeviceId, updateLastSyncedAt, _]);

  // Keep one stable debounced trigger that always calls the latest runSync (via
  // ref), so it isn't recreated — and lost — on every settings/engine change.
  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;
  const debouncedSync = useMemo(
    () => debounce(() => void runSyncRef.current(), SYNC_DEBOUNCE_MS),
    [],
  );
  useEffect(() => () => debouncedSync.cancel(), [debouncedSync]);

  // Library changes — import (adds a row), delete (sets deletedAt), book close
  // (bumps updatedAt) — all mutate `library`, so this single effect covers them
  // plus the initial load pull.
  useEffect(() => {
    if (!isReady || !engine || !libraryLoaded) return;
    debouncedSync();
  }, [library, libraryLoaded, isReady, engine, debouncedSync]);
};
