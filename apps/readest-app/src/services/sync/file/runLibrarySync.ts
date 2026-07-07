import { v4 as uuidv4 } from 'uuid';
import type { Book } from '@/types/book';
import type { EnvConfigType } from '@/services/environment';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { resolveCloudSyncGate, settingsKeyForBackend } from '@/services/sync/cloudSyncProvider';
import { createFileSyncProvider } from '@/services/sync/file/providerRegistry';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import { FileSyncEngine, type SyncLibraryResult } from '@/services/sync/file/engine';

/**
 * Run one library-wide sync against the ACTIVE third-party provider —
 * the shared execution owner for surfaces outside the auto-sync hooks
 * (the SettingsMenu sync row, pull-to-refresh) so they don't each
 * duplicate engine construction, deviceId minting, and error handling.
 *
 * Honours the same guards as `useLibraryFileSync`: never syncs a
 * not-yet-loaded library (an empty index push would clobber the remote)
 * and respects the global library-sync mutex. Returns the engine's
 * {@link SyncLibraryResult} when a sync ran to completion — callers
 * surface `booksSynced` in the toast, same as the native cloud sync —
 * and null when skipped or failed; failures record `lastError` on the
 * fileSyncStore for the health surfaces.
 */
export const runActiveFileLibrarySync = async (
  envConfig: EnvConfigType,
  _: TranslationFunc,
): Promise<SyncLibraryResult | null> => {
  const gate = resolveCloudSyncGate(useSettingsStore.getState().settings);
  // Paused means paused (#4959): a downgraded account's still-selected
  // provider must not sync, and must not fall back to Readest Cloud either.
  if (gate.provider === 'readest' || gate.paused) return null;
  const kind = gate.provider;

  if (!useLibraryStore.getState().libraryLoaded) return null;

  const syncStore = useFileSyncStore.getState();
  if (!syncStore.beginSync(kind, _('Syncing…'))) return null;

  try {
    const appService = await envConfig.getAppService();
    const current = useSettingsStore.getState().settings;
    const fileProvider = await createFileSyncProvider(kind, current);
    if (!fileProvider) return null;

    const key = settingsKeyForBackend(kind);
    const ps = current[key];
    let deviceId = ps?.deviceId;
    if (!deviceId) {
      deviceId = uuidv4();
      const next = { ...current, [key]: { ...current[key], deviceId } };
      useSettingsStore.getState().setSettings(next);
      await appService.saveSettings(next);
    }

    const store = createAppLocalStore({ appService, settings: current, envConfig });
    const engine = new FileSyncEngine(fileProvider, store);
    const strategy = ps?.strategy ?? 'silent';
    const result = await engine.syncLibrary(useLibraryStore.getState().library, {
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

    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, [key]: { ...latest[key], lastSyncedAt: Date.now() } };
    useSettingsStore.getState().setSettings(next);
    await appService.saveSettings(next);

    useFileSyncStore.getState().setLastError(kind, null);
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useFileSyncStore.getState().setLastError(kind, message);
    console.warn('[cloudSync] library file sync failed', kind, e);
    return null;
  } finally {
    useFileSyncStore.getState().endSync(kind);
  }
};

/**
 * Build the ACTIVE third-party provider's engine, or null when Readest Cloud
 * is selected / the provider cannot be constructed. Shared by the per-book
 * upload / download actions below.
 */
const buildActiveEngine = async (envConfig: EnvConfigType): Promise<FileSyncEngine | null> => {
  const settings = useSettingsStore.getState().settings;
  const gate = resolveCloudSyncGate(settings);
  if (gate.provider === 'readest' || gate.paused) return null;
  const kind = gate.provider;
  const appService = await envConfig.getAppService();
  const fileProvider = await createFileSyncProvider(kind, settings);
  if (!fileProvider) return null;
  const store = createAppLocalStore({ appService, settings, envConfig });
  return new FileSyncEngine(fileProvider, store);
};

/**
 * Explicit per-book Upload routed to the ACTIVE third-party provider — the
 * Book Details / bookshelf cloud buttons call this instead of the (gated)
 * Readest Cloud transfer queue while WebDAV / Google Drive is selected.
 * Pushes the binary (HEAD short-circuited; an already-mirrored file counts
 * as success) plus the cover, best-effort. Toasts are the caller's job.
 */
export const runActiveFileBookUpload = async (
  envConfig: EnvConfigType,
  book: Book,
): Promise<boolean> => {
  try {
    const engine = await buildActiveEngine(envConfig);
    if (!engine) return false;
    const result = await engine.pushBookFile(book);
    if (!result.uploaded && result.reason !== 'remote-matches') return false;
    try {
      await engine.pushBookCover(book);
    } catch (e) {
      console.warn('[cloudSync] book cover upload failed', book.hash, e);
    }
    return true;
  } catch (e) {
    console.warn('[cloudSync] book upload failed', book.hash, e);
    return false;
  }
};

/**
 * Explicit per-book Download routed to the ACTIVE third-party provider (also
 * reached when opening a book whose file is not local). Stamps the book's
 * downloadedAt/coverDownloadedAt like the native download path; persisting
 * the book row (updateBook) and toasts are the caller's job.
 */
export const runActiveFileBookDownload = async (
  envConfig: EnvConfigType,
  book: Book,
): Promise<boolean> => {
  try {
    const engine = await buildActiveEngine(envConfig);
    if (!engine) return false;
    const ok = await engine.downloadBookFile(book);
    if (!ok) return false;
    book.downloadedAt = Date.now();
    if (!book.coverDownloadedAt) book.coverDownloadedAt = Date.now();
    return true;
  } catch (e) {
    console.warn('[cloudSync] book download failed', book.hash, e);
    return false;
  }
};
