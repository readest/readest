import clsx from 'clsx';
import dayjs from 'dayjs';
import React from 'react';
import { MdCloudSync } from 'react-icons/md';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useTranslation, type TranslationFunc } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useFileSyncStore } from '@/store/fileSyncStore';
import { eventDispatcher } from '@/utils/event';
import { FileSyncEngine } from '@/services/sync/file/engine';
import { FileSyncError } from '@/services/sync/file/provider';
import { createAppLocalStore } from '@/services/sync/file/appLocalStore';
import {
  createFileSyncProvider,
  type FileSyncBackendKind,
} from '@/services/sync/file/providerRegistry';
import type { KOSyncStrategy } from '@/types/settings';
import { BoxedList, SettingsRow, SettingsSelect, SettingsSwitchRow } from '../primitives';

/** The settings fields the shared sync controls read/write (WebDAV + Drive share these). */
export interface FileSyncFormSettings {
  enabled?: boolean;
  syncBooks?: boolean;
  fullSync?: boolean;
  strategy?: KOSyncStrategy;
  deviceId?: string;
  lastSyncedAt?: number;
}

interface FileSyncFormProps {
  /** Which backend these controls drive (also keys the progress store + mutex). */
  kind: FileSyncBackendKind;
  /** This backend's settings slice. */
  stored: FileSyncFormSettings;
  /** Persist a patch into this backend's settings slice (must merge store-latest). */
  persist: (patch: Partial<FileSyncFormSettings>) => Promise<void>;
  /**
   * Disable the "Sync now" button — set when the connection needs attention
   * (e.g. an expired web Google Drive session) so a manual sync that would just
   * fail isn't offered. The parent panel shows the reconnect affordance.
   */
  syncNowDisabled?: boolean;
}

/**
 * Translate a sync-time error into a user-facing string. Backend-neutral: the
 * provider maps every failure to a {@link FileSyncError} with a normalised `code`
 * so we never show a raw English `e.message`.
 */
const formatSyncError = (_: TranslationFunc, e: unknown): string => {
  if (e instanceof FileSyncError) {
    switch (e.code) {
      case 'AUTH_FAILED':
        return _('Authentication failed. Reconnect in Settings.');
      case 'NOT_FOUND':
        return _('Remote resource not found');
      case 'NETWORK':
        return _('Network error');
    }
    if (typeof e.status === 'number') {
      return _('Sync failed (status {{status}})', { status: e.status });
    }
  }
  return _('Sync failed.');
};

/**
 * The provider-agnostic sync controls shared by every file-sync backend's
 * settings form: the sub-category toggles, the conflict strategy, and a manual
 * "Sync now" button with progress + result toast. The backend-specific connect
 * panel (WebDAV URL/credentials, the Drive Connect button) lives in the parent
 * form; everything below the connect line is identical across backends, so it
 * lives here once and is parameterised by {@link FileSyncFormProps.kind}.
 */
const FileSyncForm: React.FC<FileSyncFormProps> = ({
  kind,
  stored,
  persist,
  syncNowDisabled = false,
}) => {
  const _ = useTranslation();
  const { settings } = useSettingsStore();
  const { envConfig } = useEnv();

  const isSyncing = useFileSyncStore((s) => s.byKind[kind]?.isSyncing ?? false);
  const syncProgressLabel = useFileSyncStore((s) => s.byKind[kind]?.progressLabel ?? null);
  const syncProgressDetail = useFileSyncStore((s) => s.byKind[kind]?.progressDetail ?? null);
  const beginSync = useFileSyncStore((s) => s.beginSync);
  const updateProgress = useFileSyncStore((s) => s.updateProgress);
  const endSync = useFileSyncStore((s) => s.endSync);
  const setLastError = useFileSyncStore((s) => s.setLastError);

  const handleToggleSyncBooks = () => persist({ syncBooks: !(stored.syncBooks ?? false) });
  const handleToggleFullSync = () => persist({ fullSync: !(stored.fullSync ?? false) });
  const handleStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    await persist({ strategy: e.target.value as KOSyncStrategy });
  };

  /**
   * Manual "Sync now" — reconcile the local library with the remote over a
   * bounded-concurrency pool. Incremental by default (only books whose local
   * copy differs from the shared index); "Full Sync" re-checks every book. The
   * provider is built by kind through the registry so this stays backend-neutral.
   */
  const handleSyncNow = async () => {
    if (syncNowDisabled) return;
    if (useFileSyncStore.getState().byKind[kind]?.isSyncing) return;
    if (!stored.enabled) return;

    const { libraryLoaded, library } = useLibraryStore.getState();
    const appService = await envConfig.getAppService();

    let currentLibrary = library ?? [];
    if (!libraryLoaded && appService) {
      currentLibrary = await appService.loadLibraryBooks();
      // Hydrate the store before syncing so the engine's addBookToLibrary /
      // updateBookMetadata merge against the real library, not an empty one.
      useLibraryStore.getState().setLibrary(currentLibrary);
    }

    // Count only live books for the progress label, but sync the FULL library
    // (including soft-deleted books): the engine tombstones deleted books in
    // library.json so deletions propagate, and keeping them in the input set
    // stops the discovery pass from re-downloading a book the user just deleted.
    const liveBookCount = currentLibrary.filter((b) => !b.deletedAt).length;

    // Lazily ensure a deviceId so the first cross-device sync attributes its
    // rows correctly (the reader hook also touches this on first push).
    let deviceId = stored.deviceId;
    if (!deviceId) {
      deviceId = uuidv4();
      await persist({ deviceId });
    }

    // Acquire the global library-sync mutex; bail if another backend's Sync now
    // is already mutating the local library.
    if (!beginSync(kind, _('Syncing {{n}} / {{total}}', { n: 0, total: liveBookCount }))) {
      return;
    }

    try {
      const provider = await createFileSyncProvider(kind, settings);
      if (!provider) {
        throw new FileSyncError('Sync backend is not available on this device', 'UNKNOWN');
      }
      const store = createAppLocalStore({ appService, settings, envConfig });
      const engine = new FileSyncEngine(provider, store);
      const result = await engine.syncLibrary(currentLibrary, {
        strategy: stored.strategy === 'prompt' ? 'silent' : stored.strategy,
        syncBooks: stored.syncBooks ?? false,
        fullSync: stored.fullSync ?? false,
        deviceId: deviceId as string,
        onProgress: ({ book, index, total, action }) => {
          const actionStr = action === 'downloading' ? _('Downloading') : _('Uploading');
          updateProgress(
            kind,
            _('{{action}} {{n}} / {{total}}', { action: actionStr, n: index + 1, total }),
            book.title || book.hash.slice(0, 8),
          );
        },
      });

      await persist({ lastSyncedAt: Date.now() });
      // A completed run heals the provider's health surfaces (the Cloud Sync
      // chooser row, the SettingsMenu sync row) — otherwise a pre-restart
      // failure keeps reading "Sync failed" after a successful manual sync.
      setLastError(kind, null);
      if (result.failures > 0) {
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Sync finished with {{failed}} failure(s). {{ok}} ok.', {
            failed: result.failures,
            ok: Math.max(0, result.totalBooks - result.failures),
          }),
        });
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('{{count}} book(s) synced', { count: result.booksSynced }),
        });
      }
    } catch (e) {
      setLastError(kind, e instanceof Error ? e.message : String(e));
      eventDispatcher.dispatch('toast', { type: 'error', message: formatSyncError(_, e) });
    } finally {
      endSync(kind);
    }
  };

  return (
    <BoxedList>
      <SettingsSwitchRow
        label={_('Upload Book Files')}
        description={_('Uploads book files to your other devices')}
        checked={stored.syncBooks ?? false}
        onChange={handleToggleSyncBooks}
      />
      <SettingsSwitchRow
        label={_('Full Sync')}
        description={_('Re-check every book instead of only changed ones')}
        checked={stored.fullSync ?? false}
        onChange={handleToggleFullSync}
      />
      <SettingsRow label={_('Sync Strategy')}>
        <SettingsSelect
          value={stored.strategy ?? 'silent'}
          onChange={handleStrategyChange}
          ariaLabel={_('Sync Strategy')}
          options={[
            { value: 'silent', label: _('Send and receive') },
            { value: 'send', label: _('Send only') },
            { value: 'receive', label: _('Receive only') },
          ]}
        />
      </SettingsRow>
      <SettingsRow
        label={
          syncProgressLabel
            ? syncProgressLabel
            : stored.lastSyncedAt
              ? _('Synced {{time}}', { time: dayjs(stored.lastSyncedAt).fromNow() })
              : _('Never synced')
        }
        description={
          syncProgressDetail ? (
            <span className='line-clamp-1'>{syncProgressDetail}</span>
          ) : undefined
        }
      >
        <button
          type='button'
          onClick={handleSyncNow}
          disabled={isSyncing || syncNowDisabled}
          className={clsx(
            'btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2',
            (isSyncing || syncNowDisabled) && 'opacity-60',
          )}
          title={_('Sync now')}
          aria-label={_('Sync now')}
        >
          {isSyncing ? (
            <span className='loading loading-spinner loading-xs' />
          ) : (
            <MdCloudSync className='h-4 w-4' />
          )}
          {_('Sync now')}
        </button>
      </SettingsRow>
    </BoxedList>
  );
};

export default FileSyncForm;
