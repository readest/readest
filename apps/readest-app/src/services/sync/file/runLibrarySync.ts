import { v4 as uuidv4 } from 'uuid';
import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { TranslationFunc } from '@/hooks/useTranslation';
import type { SystemSettings } from '@/types/settings';
import type { UserPlan } from '@/types/quota';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { isWebAppPlatform } from '@/services/environment';
import { hasValidWebDriveToken } from '@/services/sync/providers/gdrive/auth/webTokenStore';
import {
  getActiveFileSyncBackends,
  settingsKeyForBackend,
} from '@/services/sync/cloudSyncProvider';
import {
  createFileSyncProvider,
  type FileSyncBackendKind,
} from '@/services/sync/file/providerRegistry';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import { FileSyncEngine, type SyncLibraryResult } from '@/services/sync/file/engine';

/**
 * Whether a backend's transport can work at all right now. Web Google Drive
 * tokens are session-scoped with no refresh; once expired, every run aborts with
 * a terminal AUTH_FAILED on the index pull. Skipping is quieter than failing:
 * the Drive settings form already shows a Reconnect CTA, and a doomed request on
 * every library change would just spam the log and the row's error state.
 *
 * This lives in the runner, not the hooks, so the manual "Sync now", the library
 * auto-sync, and the reader's per-book sync all honour it.
 */
export const canBackendRun = (kind: FileSyncBackendKind): boolean =>
  !(kind === 'gdrive' && isWebAppPlatform() && !hasValidWebDriveToken());

/**
 * The enabled backends that can ACTUALLY sync right now — {@link
 * getActiveFileSyncBackends} minus any that {@link canBackendRun} rules out
 * (web Google Drive with a gone/expired token). Display surfaces use this so a
 * provider that is enabled but silently skipped is not counted as active or
 * reported as synced.
 */
export const getReadyFileSyncBackends = (
  settings: SystemSettings | null | undefined,
  plan?: UserPlan,
): FileSyncBackendKind[] =>
  getActiveFileSyncBackends(settings, plan).filter((k) => canBackendRun(k));

/** Build one backend's engine, or null when it cannot run here. */
const buildEngine = async (
  envConfig: EnvConfigType,
  kind: FileSyncBackendKind,
): Promise<FileSyncEngine | null> => {
  if (!canBackendRun(kind)) return null;
  const settings = useSettingsStore.getState().settings;
  const appService = await envConfig.getAppService();
  const fileProvider = await createFileSyncProvider(kind, settings);
  if (!fileProvider) return null;
  const store = createAppLocalStore({ appService, settings, envConfig });
  return new FileSyncEngine(fileProvider, store);
};

/** One backend's library sync. Throws; the caller isolates the failure. */
const syncOneBackend = async (
  envConfig: EnvConfigType,
  kind: FileSyncBackendKind,
  _: TranslationFunc,
): Promise<SyncLibraryResult | null> => {
  const appService = await envConfig.getAppService();
  const current = useSettingsStore.getState().settings;
  const engine = await buildEngine(envConfig, kind);
  if (!engine) return null;

  const key = settingsKeyForBackend(kind);
  const ps = current[key];
  let deviceId = ps?.deviceId;
  if (!deviceId) {
    deviceId = uuidv4();
    const next = { ...current, [key]: { ...current[key], deviceId } };
    useSettingsStore.getState().setSettings(next);
    await appService.saveSettings(next);
  }

  const strategy = ps?.strategy ?? 'silent';
  const result = await engine.syncLibrary(useLibraryStore.getState().library, {
    strategy: strategy === 'prompt' ? 'silent' : strategy,
    syncBooks: ps?.syncBooks ?? false,
    fullSync: false,
    concurrency: 6,
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

  const latest = useSettingsStore.getState().settings;
  const next = { ...latest, [key]: { ...latest[key], lastSyncedAt: Date.now() } };
  useSettingsStore.getState().setSettings(next);
  await appService.saveSettings(next);
  return result;
};

/**
 * Run one library-wide sync PASS across every enabled third-party backend
 * (#5062) — the shared execution owner for surfaces outside the auto-sync hooks
 * (the SettingsMenu sync row, pull to refresh).
 *
 * The backends run one after another, in a fixed order, against the SAME local
 * library — which is the merge point, so backend N sees everything backends
 * 1..N-1 pulled in. The last-to-first edge lands on the next pass; a pull that
 * changed the library re-triggers the debounced auto-sync, so it converges
 * without extra machinery.
 *
 * The mutex is held for the WHOLE pass, not per backend: releasing between
 * backends would let an auto-sync start a second reconcile of the same library.
 *
 * Failure is isolated per backend. An expired Drive token throws a terminal
 * AUTH_FAILED, and the pass records it and moves on — redundancy is worthless
 * if a dead mirror takes the live one down with it. Returns the summed result
 * of the backends that succeeded, or null when none did.
 */
export const runFileLibrarySyncPass = async (
  envConfig: EnvConfigType,
  _: TranslationFunc,
): Promise<SyncLibraryResult | null> => {
  // Paused means paused (#4959): a downgraded account's still-enabled backends
  // must not sync, and must not fall back to Readest Cloud either.
  const backends = getActiveFileSyncBackends(useSettingsStore.getState().settings);
  if (backends.length === 0) return null;

  // NEVER sync a library that is not loaded from disk: pushing an empty index
  // would clobber the remote.
  if (!useLibraryStore.getState().libraryLoaded) return null;

  if (!useFileSyncStore.getState().beginSync(backends[0]!, _('Syncing…'))) return null;

  let merged: SyncLibraryResult | null = null;
  try {
    for (let i = 0; i < backends.length; i++) {
      const kind = backends[i]!;
      if (i > 0) useFileSyncStore.getState().switchSync(kind, _('Syncing…'));
      try {
        const result = await syncOneBackend(envConfig, kind, _);
        useFileSyncStore.getState().setLastError(kind, null);
        if (result) {
          merged = merged
            ? { ...result, booksSynced: merged.booksSynced + result.booksSynced }
            : result;
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        useFileSyncStore.getState().setLastError(kind, message);
        console.warn('[cloudSync] library file sync failed', kind, e);
      }
    }
  } finally {
    const held = useFileSyncStore.getState().activeKind;
    useFileSyncStore.getState().endSync(held ?? backends[0]!);
  }
  return merged;
};

/**
 * Explicit per-book Upload, mirrored to EVERY enabled backend — the Book Details
 * / bookshelf cloud buttons call this alongside (or instead of) the Readest
 * Cloud transfer queue. Pushes the binary (HEAD short-circuited; an
 * already-mirrored file counts as success) plus the cover, best-effort per
 * backend. Succeeds when at least one backend took the book. Toasts are the
 * caller's job.
 */
export const runFileBookUpload = async (envConfig: EnvConfigType, book: Book): Promise<boolean> => {
  const backends = getActiveFileSyncBackends(useSettingsStore.getState().settings);
  let anyUploaded = false;
  for (const kind of backends) {
    try {
      const engine = await buildEngine(envConfig, kind);
      if (!engine) continue;
      const result = await engine.pushBookFile(book);
      if (!result.uploaded && result.reason !== 'remote-matches') continue;
      anyUploaded = true;
      try {
        await engine.pushBookCover(book);
      } catch (e) {
        console.warn('[cloudSync] book cover upload failed', kind, book.hash, e);
      }
    } catch (e) {
      console.warn('[cloudSync] book upload failed', kind, book.hash, e);
    }
  }
  return anyUploaded;
};

/**
 * Explicit per-book Download (also reached when opening a book whose file is not
 * local). Tries the enabled backends in order and stops at the first one holding
 * the file — the mirrors are equivalent, so there is nothing to gain from asking
 * the rest. Stamps downloadedAt/coverDownloadedAt like the native download path;
 * persisting the book row (updateBook) and toasts are the caller's job.
 */
export const runFileBookDownload = async (
  envConfig: EnvConfigType,
  book: Book,
): Promise<boolean> => {
  const backends = getActiveFileSyncBackends(useSettingsStore.getState().settings);
  for (const kind of backends) {
    try {
      const engine = await buildEngine(envConfig, kind);
      if (!engine) continue;
      if (!(await engine.downloadBookFile(book))) continue;
      book.downloadedAt = Date.now();
      if (!book.coverDownloadedAt) book.coverDownloadedAt = Date.now();
      return true;
    } catch (e) {
      console.warn('[cloudSync] book download failed', kind, book.hash, e);
    }
  }
  return false;
};
