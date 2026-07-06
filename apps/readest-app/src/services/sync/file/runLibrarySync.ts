import { v4 as uuidv4 } from 'uuid';
import type { EnvConfigType } from '@/services/environment';
import type { TranslationFunc } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { getCloudSyncProvider } from '@/services/sync/cloudSyncProvider';
import { createFileSyncProvider } from '@/services/sync/file/providerRegistry';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import { FileSyncEngine } from '@/services/sync/file/engine';

/**
 * Run one library-wide sync against the ACTIVE third-party provider —
 * the shared execution owner for surfaces outside the auto-sync hooks
 * (the SettingsMenu sync row, pull-to-refresh) so they don't each
 * duplicate engine construction, deviceId minting, and error handling.
 *
 * Honours the same guards as `useLibraryFileSync`: never syncs a
 * not-yet-loaded library (an empty index push would clobber the remote)
 * and respects the global library-sync mutex. Returns true only when a
 * sync actually ran to completion; failures record `lastError` on the
 * fileSyncStore for the health surfaces.
 */
export const runActiveFileLibrarySync = async (
  envConfig: EnvConfigType,
  _: TranslationFunc,
): Promise<boolean> => {
  const provider = getCloudSyncProvider(useSettingsStore.getState().settings);
  if (provider === 'readest') return false;
  const kind = provider;

  if (!useLibraryStore.getState().libraryLoaded) return false;

  const syncStore = useFileSyncStore.getState();
  if (!syncStore.beginSync(kind, _('Syncing…'))) return false;

  try {
    const appService = await envConfig.getAppService();
    const current = useSettingsStore.getState().settings;
    const fileProvider = await createFileSyncProvider(kind, current);
    if (!fileProvider) return false;

    const key = kind === 'gdrive' ? 'googleDrive' : 'webdav';
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
    await engine.syncLibrary(useLibraryStore.getState().library, {
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
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    useFileSyncStore.getState().setLastError(kind, message);
    console.warn('[cloudSync] library file sync failed', kind, e);
    return false;
  } finally {
    useFileSyncStore.getState().endSync(kind);
  }
};
