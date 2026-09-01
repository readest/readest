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
import { FileSyncEngine, type SyncFailureEntry } from '@/services/sync/file/engine';
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
 * so we never show a raw English `e.message` as the headline. The diagnostic
 * detail below deliberately preserves the provider's original reason.
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

const formatFailurePhase = (_: TranslationFunc, phase: SyncFailureEntry['phase']): string => {
  switch (phase) {
    case 'download':
      return _('Download');
    case 'upload-config':
      return _('Upload config');
    case 'upload-file':
      return _('Upload book file');
    case 'upload-cover':
      return _('Upload cover');
  }
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
  const [lastFailureDetail, setLastFailureDetail] = React.useState<string | null>(null);

  const isSyncing = useFileSyncStore((s) => s.byKind[kind]?.isSyncing ?? false);
  const syncProgressLabel = useFileSyncStore((s) => s.byKind[kind]?.progressLabel ?? null);
  const syncProgressDetail = useFileSyncStore((s) => s.byKind[kind]?.progressDetail ?? null);
  const syncProgressPercent = useFileSyncStore((s) => s.byKind[kind]?.progressPercent ?? null);
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

    setLastFailureDetail(null);
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
          const actionStr =
            action === 'downloading'
              ? _('Downloading')
              : action === 'uploading-files'
                ? _('Uploading files')
                : _('Uploading');
          updateProgress(
            kind,
            _('{{action}} {{n}} / {{total}}', { action: actionStr, n: index + 1, total }),
            book.title || book.hash.slice(0, 8),
            total > 0 ? Math.round(((index + 1) / total) * 100) : null,
          );
        },
      });

      await persist({ lastSyncedAt: Date.now() });
      // `result.failures` counts failed PIPELINE PHASES. One book can therefore
      // contribute two or more failures (config + binary, for example). Count
      // distinct hashes for the user-facing book total and keep every phase in
      // the diagnostic detail so the underlying cause is not hidden.
      const failedHashes = new Set(result.failedBooks.map((failure) => failure.hash));
      const failedBookCount = failedHashes.size;
      const okBookCount = Math.max(0, result.totalBooks - failedBookCount);
      const failureLines = result.failedBooks.map(
        (failure) =>
          `${failure.title || failure.hash.slice(0, 8)} · ${formatFailurePhase(_, failure.phase)} · ${failure.reason}`,
      );
      if (result.indexPushFailed) {
        failureLines.push(_('Library index upload failed; other devices may not see these changes.'));
      }
      const detail = failureLines.join('\n');
      setLastFailureDetail(detail || null);

      // A fully successful run heals the provider's health surfaces. A partial
      // run should remain visibly unhealthy: otherwise the settings row says
      // success while the diagnostic list immediately below says books failed.
      if (failedBookCount > 0 || result.indexPushFailed) {
        setLastError(kind, detail || _('Sync finished with errors'));
        eventDispatcher.dispatch('toast', {
          type: 'warning',
          message: _('Sync finished: {{ok}} ok, {{failed}} book(s) failed.', {
            failed: failedBookCount,
            ok: okBookCount,
          }),
        });
      } else {
        setLastError(kind, null);
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('{{count}} book(s) synced', { count: result.booksSynced }),
        });
      }
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setLastError(kind, raw);
      setLastFailureDetail(raw);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: `${formatSyncError(_, e)} ${raw}`.trim(),
      });
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
          <span className='flex w-full flex-col gap-1.5'>
            <span>
              {syncProgressLabel
                ? syncProgressLabel
                : stored.lastSyncedAt
                  ? _('Synced {{time}}', { time: dayjs(stored.lastSyncedAt).fromNow() })
                  : _('Never synced')}
            </span>
            {isSyncing && syncProgressPercent != null && (
              <span
                aria-hidden
                className='bg-base-300 block h-1.5 w-full overflow-hidden rounded-full'
              >
                <span
                  className='bg-primary block h-full rounded-full transition-[width] duration-300'
                  style={{ width: `${Math.max(2, Math.min(100, syncProgressPercent))}%` }}
                />
              </span>
            )}
          </span>
        }
        description={
          syncProgressDetail ? (
            <span className='line-clamp-1'>{syncProgressDetail}</span>
          ) : lastFailureDetail ? (
            <span className='text-error whitespace-pre-wrap break-words text-xs leading-relaxed'>
              {lastFailureDetail}
            </span>
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
