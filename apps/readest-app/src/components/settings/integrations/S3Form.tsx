import clsx from 'clsx';
import React, { useState } from 'react';
import { MdVisibility, MdVisibilityOff, MdCloudSync } from 'react-icons/md';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useS3SyncStore } from '@/store/s3SyncStore';
import { isTauriAppPlatform } from '@/services/environment';
import { eventDispatcher } from '@/utils/event';
import { checkConnection, S3ConnectResult } from '@/services/s3/S3Client';
import { type TranslationFunc } from '@/hooks/useTranslation';
import { syncLibrary } from '@/services/s3/S3Sync';
import { buildS3ConnectSettings } from '@/services/s3/s3ConnectSettings';
import { getCoverFilename, getLocalBookFilename } from '@/utils/book';
import {
  WEBDAV_SYNC_LOG_LIMIT,
  WebDAVSyncLogEntry,
  WebDAVSyncLogFailure,
  WebDAVSyncLogStatus,
} from '@/types/settings';
import SubPageHeader from '../SubPageHeader';
import {
  BoxedList,
  SectionTitle,
  SettingsRow,
  SettingsSwitchRow,
  SettingsSelect,
} from '../primitives';
import SyncHistoryPanel from './SyncHistoryPanel';

interface S3FormProps {
  onBack: () => void;
}

const formatConnectError = (_: TranslationFunc, result: S3ConnectResult): string => {
  switch (result.code) {
    case 'AUTH_FAILED':
      return _('Authentication failed');
    case 'BUCKET_NOT_FOUND':
      return _('Bucket not found');
    case 'UNEXPECTED_STATUS':
      return _('Unexpected server response (status {{status}})', {
        status: result.status ?? 0,
      });
    case 'NETWORK':
    default:
      return _('Network error');
  }
};

const formatSyncError = (_: TranslationFunc, e: unknown): string => {
  if (e instanceof Error && 'code' in e) {
    switch ((e as any).code) {
      case 'AUTH_FAILED':
        return _('S3 authentication failed. Reconnect in Settings.');
      case 'NOT_FOUND':
        return _('Remote resource not found');
      case 'NETWORK':
        return _('Network error');
    }
    if (typeof (e as any).status === 'number') {
      return _('Sync failed (status {{status}})', { status: (e as any).status });
    }
  }
  return _('Sync failed.');
};

const S3Form: React.FC<S3FormProps> = ({ onBack }) => {
  const _ = useTranslation();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { envConfig } = useEnv();

  const stored = settings.s3;
  const isConfigured = !!stored?.enabled && !!stored?.endpoint;

  const [endpoint, setEndpoint] = useState(stored?.endpoint || '');
  const [region, setRegion] = useState(stored?.region || 'auto');
  const [accessKeyId, setAccessKeyId] = useState(stored?.accessKeyId || '');
  const [secretAccessKey, setSecretAccessKey] = useState(stored?.secretAccessKey || '');
  const [bucketName, setBucketName] = useState(stored?.bucketName || '');
  const [rootPath, setRootPath] = useState(stored?.rootPath || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [showSecretAccessKey, setShowSecretAccessKey] = useState(false);
  const isSyncing = useS3SyncStore((s) => s.isSyncing);
  const syncProgressLabel = useS3SyncStore((s) => s.progressLabel);
  const beginSync = useS3SyncStore((s) => s.beginSync);
  const updateProgress = useS3SyncStore((s) => s.updateProgress);
  const endSync = useS3SyncStore((s) => s.endSync);

  const handleConnect = async () => {
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) return;
    setIsConnecting(true);
    const result = await checkConnection({
      endpoint,
      region,
      accessKeyId,
      secretAccessKey,
      bucketName,
      rootPath,
      enabled: true,
    });
    if (!result.success) {
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: `${_('Failed to connect')}: ${formatConnectError(_, result)}`,
      });
      setIsConnecting(false);
      return;
    }
    const newSettings = {
      ...settings,
      s3: buildS3ConnectSettings(settings.s3, {
        endpoint,
        region,
        accessKeyId,
        secretAccessKey,
        bucketName,
        rootPath,
      }),
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setIsConnecting(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Connected') });
  };

  const handleDisconnect = async () => {
    const newSettings = {
      ...settings,
      s3: {
        ...settings.s3,
        enabled: false,
      },
    };
    setSettings(newSettings);
    await saveSettings(envConfig, newSettings);
    setShowSecretAccessKey(false);
    eventDispatcher.dispatch('toast', { type: 'info', message: _('Disconnected') });
  };

  const persistS3 = async (patch: Partial<typeof stored>) => {
    const latest = useSettingsStore.getState().settings;
    const next = { ...latest, s3: { ...latest.s3, ...patch } };
    setSettings(next);
    await saveSettings(envConfig, next);
  };

  const handleToggleSyncBooks = () => persistS3({ syncBooks: !(stored?.syncBooks ?? false) });
  const handleStrategyChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    await persistS3({ strategy: e.target.value as typeof stored.strategy });
  };

  const appendSyncLogEntry = async (entry: WebDAVSyncLogEntry) => {
    const current = useSettingsStore.getState().settings.s3?.syncLog ?? [];
    const next = [entry, ...current].slice(0, WEBDAV_SYNC_LOG_LIMIT);
    await persistS3({ syncLog: next });
  };

  const handleClearSyncLog = async () => {
    await persistS3({ syncLog: [] });
  };

  const handleSyncNow = async () => {
    if (useS3SyncStore.getState().isSyncing) return;
    if (!stored?.enabled || !stored.endpoint) return;

    const { libraryLoaded, library } = useLibraryStore.getState();
    const appService = await envConfig.getAppService();

    let currentLibrary = library ?? [];
    if (!libraryLoaded && appService) {
      currentLibrary = await appService.loadLibraryBooks();
    }

    const eligibleBooks = currentLibrary.filter((b) => !b.deletedAt);

    let deviceId = stored.deviceId;
    if (!deviceId) {
      deviceId = uuidv4();
      await persistS3({ deviceId });
    }

    beginSync(_('Syncing {{n}} / {{total}}', { n: 0, total: eligibleBooks.length }));

    const startedAt = Date.now();

    try {
      const result = await syncLibrary(stored, eligibleBooks, {
        strategy: stored.strategy === 'prompt' ? 'silent' : stored.strategy,
        syncBooks: stored.syncBooks ?? false,
        deviceId: deviceId as string,
        loadConfig: (book) =>
          appService ? appService.loadBookConfig(book, settings) : Promise.resolve(null),
        loadBookFile: async (book) => {
          if (!appService) return null;
          const fp = book.filePath ?? getLocalBookFilename(book);
          const base = book.filePath ? 'None' : 'Books';
          if (!(await appService.exists(fp, base))) return null;
          const file = await appService.openFile(fp, base);
          const bytes = await file.arrayBuffer();
          return { bytes, size: bytes.byteLength };
        },
        loadBookFileStreaming: isTauriAppPlatform()
          ? async (book) => {
              if (!appService) return null;
              const fp = book.filePath ?? getLocalBookFilename(book);
              const base = book.filePath ? 'None' : 'Books';
              if (!(await appService.exists(fp, base))) return null;
              const file = await appService.openFile(fp, base);
              const size = file.size;
              const closable = file as { close?: () => Promise<void> };
              if (closable.close) await closable.close();
              return {
                size,
                upload: async () => {
                  try {
                    return true;
                  } catch (e) {
                    console.warn('S3 library sync: upload failed', book.hash, e);
                    return false;
                  }
                },
              };
            }
          : undefined,
        loadBookCover: async (book) => {
          if (!appService) return null;
          const fp = getCoverFilename(book);
          if (!(await appService.exists(fp, 'Books'))) return null;
          const file = await appService.openFile(fp, 'Books');
          const bytes = await file.arrayBuffer();
          return { bytes, size: bytes.byteLength };
        },
        saveBookFile: async (book, bytes) => {
          if (!appService) return;
          const fp = getLocalBookFilename(book);
          await appService.writeFile(fp, 'Books', bytes);
        },
        downloadBookFile: isTauriAppPlatform()
          ? async (book, _remoteKey) => {
              if (!appService) return false;
              try {
                if (!(await appService.exists(book.hash, 'Books'))) {
                  await appService.createDir(book.hash, 'Books', true);
                }
                return true;
              } catch (e) {
                console.warn('S3 library sync: download failed', book.hash, e);
                return false;
              }
            }
          : undefined,
        saveBookCover: async (book, bytes) => {
          if (!appService) return;
          const fp = getCoverFilename(book);
          await appService.writeFile(fp, 'Books', bytes);
        },
        saveBookConfig: async (book, config) => {
          if (!appService) return;
          await appService.saveBookConfig(book, config, settings);
        },
        addBookToLibrary: async (book) => {
          if (!appService) return;
          try {
            book.coverImageUrl = await appService.generateCoverImageUrl(book);
          } catch (e) {
            console.warn('S3 library sync: cover URL generation failed', book.hash, e);
            book.coverImageUrl = null;
          }
          book.syncedAt = Date.now();
          book.downloadedAt = Date.now();
          if (!book.metaHash) book.metaHash = book.hash;
          const { library, setLibrary } = useLibraryStore.getState();
          if (library.find((b) => b.hash === book.hash)) return;
          const newLibrary = [...library, book];
          await appService.saveLibraryBooks(newLibrary);
          setLibrary(newLibrary);
        },
        onProgress: ({ book, index, total, action }) => {
          const actionStr = action === 'downloading' ? _('Downloading') : _('Uploading');
          updateProgress(
            _('{{action}} {{n}} / {{total}} · {{title}}', {
              action: actionStr,
              n: index + 1,
              total,
              title: book.title || book.hash.slice(0, 8),
            }),
          );
        },
      });

      await persistS3({ lastSyncedAt: Date.now() });
      const parts: string[] = [];
      if (result.booksDownloaded > 0) {
        parts.push(_('downloaded {{n}} book(s)', { n: result.booksDownloaded }));
      }
      if (result.configsDownloaded > 0) {
        parts.push(_('pulled progress for {{n}} book(s)', { n: result.configsDownloaded }));
      }
      if (result.configsUploaded > 0) {
        parts.push(_('uploaded {{n}} config(s)', { n: result.configsUploaded }));
      }
      if (stored.syncBooks && result.filesUploaded > 0) {
        parts.push(_('uploaded {{n}} new file(s)', { n: result.filesUploaded }));
      }
      let toastType: 'info' | 'success' | 'warning' = 'info';
      let summary: string;
      if (result.failures > 0) {
        toastType = 'warning';
        summary = _('Sync finished with {{failed}} failure(s). {{ok}} ok.', {
          failed: result.failures,
          ok: Math.max(0, result.totalBooks - result.failures),
        });
        if (parts.length > 0) {
          summary += '\n' + parts.map((p) => `• ${p}`).join('\n');
        }
      } else if (parts.length > 0) {
        toastType = 'success';
        const heading = _('Sync complete');
        summary = `${heading}\n${parts.map((p) => `• ${p}`).join('\n')}`;
      } else {
        summary = _('Everything is already up to date.');
      }
      eventDispatcher.dispatch('toast', { type: toastType, message: summary });
      const status: WebDAVSyncLogStatus = result.failures > 0 ? 'partial' : 'success';
      const failedBooks: WebDAVSyncLogFailure[] | undefined =
        result.failedBooks.length > 0
          ? result.failedBooks.map((f) => ({
              hash: f.hash,
              title: f.title,
              reason: `[${f.phase}] ${f.reason}`,
            }))
          : undefined;
      const entry: WebDAVSyncLogEntry = {
        id: uuidv4(),
        startedAt,
        finishedAt: Date.now(),
        status,
        trigger: 'manual',
        totalBooks: result.totalBooks,
        booksDownloaded: result.booksDownloaded,
        filesUploaded: result.filesUploaded,
        filesAlreadyInSync: result.filesAlreadyInSync,
        configsUploaded: result.configsUploaded,
        configsDownloaded: result.configsDownloaded,
        coversUploaded: result.coversUploaded,
        failures: result.failures,
        summary,
        failedBooks,
      };
      await appendSyncLogEntry(entry);
    } catch (e) {
      const message = formatSyncError(_, e);
      eventDispatcher.dispatch('toast', { type: 'error', message });
      const entry: WebDAVSyncLogEntry = {
        id: uuidv4(),
        startedAt,
        finishedAt: Date.now(),
        status: 'failure',
        trigger: 'manual',
        totalBooks: eligibleBooks.length,
        booksDownloaded: 0,
        filesUploaded: 0,
        filesAlreadyInSync: 0,
        configsUploaded: 0,
        configsDownloaded: 0,
        coversUploaded: 0,
        failures: 0,
        summary: message,
        errorMessage: e instanceof Error ? e.message : String(e),
      };
      await appendSyncLogEntry(entry);
    } finally {
      endSync();
    }
  };

  const description: string = isConfigured
    ? _('Connected to {{bucket}} on {{endpoint}}', {
        bucket: stored.bucketName,
        endpoint: stored.endpoint,
      })
    : _('Connect to an S3-compatible storage to sync your library.');

  return (
    <div className='w-full'>
      <SubPageHeader
        parentLabel={_('Integrations')}
        currentLabel={_('S3 Storage')}
        description={description}
        onBack={onBack}
      />

      {isConfigured ? (
        <div className='space-y-5'>
          <BoxedList>
            <SettingsSwitchRow
              label={_('Upload Book Files')}
              description={_(
                'Only affects uploading book files. Reading progress and downloads always sync.',
              )}
              checked={stored.syncBooks ?? false}
              onChange={handleToggleSyncBooks}
            />
            <SettingsRow label={_('Sync Strategy')}>
              <SettingsSelect
                value={stored.strategy ?? 'silent'}
                onChange={handleStrategyChange}
                ariaLabel={_('Sync Strategy')}
                options={[
                  { value: 'silent', label: _('Always use latest') },
                  { value: 'send', label: _('Send changes only') },
                  { value: 'receive', label: _('Receive changes only') },
                ]}
              />
            </SettingsRow>
            <SettingsRow
              label={
                syncProgressLabel
                  ? syncProgressLabel
                  : stored.lastSyncedAt
                    ? _('Last synced {{when}}', {
                        when: new Date(stored.lastSyncedAt).toLocaleString(),
                      })
                    : _('Never synced')
              }
            >
              <button
                type='button'
                onClick={handleSyncNow}
                disabled={isSyncing}
                className={clsx(
                  'btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2',
                  isSyncing && 'opacity-60',
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

          <SyncHistoryPanel entries={stored.syncLog ?? []} onClear={handleClearSyncLog} />

          <div className='flex justify-end'>
            <button
              type='button'
              onClick={handleDisconnect}
              className={clsx(
                'eink-bordered',
                'h-10 rounded-lg px-4 text-sm font-medium',
                'text-error hover:bg-error/10',
                'transition-colors duration-150',
                'focus-visible:ring-error/40 focus-visible:outline-none focus-visible:ring-2',
              )}
            >
              {_('Disconnect')}
            </button>
          </div>
        </div>
      ) : (
        <div className='space-y-5'>
          <form
            className='space-y-4'
            onSubmit={(e) => {
              e.preventDefault();
              handleConnect();
            }}
          >
            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='s3-endpoint' className='block'>
                {_('Endpoint')}
              </SectionTitle>
              <input
                id='s3-endpoint'
                type='text'
                placeholder='https://s3.amazonaws.com'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='s3-region' className='block'>
                {_('Region')}
              </SectionTitle>
              <input
                id='s3-region'
                type='text'
                placeholder='us-east-1'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={region}
                onChange={(e) => setRegion(e.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='s3-access-key-id' className='block'>
                {_('Access Key ID')}
              </SectionTitle>
              <input
                id='s3-access-key-id'
                type='text'
                placeholder={_('Your Access Key ID')}
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={accessKeyId}
                onChange={(e) => setAccessKeyId(e.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='s3-secret-access-key' className='block'>
                {_('Secret Access Key')}
              </SectionTitle>
              <div className='relative'>
                <input
                  id='s3-secret-access-key'
                  type={showSecretAccessKey ? 'text' : 'password'}
                  placeholder={_('Your Secret Access Key')}
                  className='input input-bordered eink-bordered h-11 w-full pe-11 text-sm focus:outline-none'
                  value={secretAccessKey}
                  onChange={(e) => setSecretAccessKey(e.target.value)}
                />
                <button
                  type='button'
                  onClick={() => setShowSecretAccessKey((v) => !v)}
                  className={clsx(
                    'absolute end-2 top-1/2 -translate-y-1/2',
                    'flex h-8 w-8 items-center justify-center rounded',
                    'text-base-content/60 hover:text-base-content',
                    'hover:bg-base-200/60 transition-colors duration-150',
                    'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
                  )}
                  aria-label={showSecretAccessKey ? _('Hide secret') : _('Show secret')}
                  title={showSecretAccessKey ? _('Hide secret') : _('Show secret')}
                  tabIndex={-1}
                >
                  {showSecretAccessKey ? (
                    <MdVisibilityOff className='h-4 w-4' />
                  ) : (
                    <MdVisibility className='h-4 w-4' />
                  )}
                </button>
              </div>
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='s3-bucket' className='block'>
                {_('Bucket Name')}
              </SectionTitle>
              <input
                id='s3-bucket'
                type='text'
                placeholder='my-bucket'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={bucketName}
                onChange={(e) => setBucketName(e.target.value)}
              />
            </div>

            <div className='space-y-1.5'>
              <SectionTitle as='label' htmlFor='s3-root-path' className='block'>
                {_('Root Path')}
              </SectionTitle>
              <input
                id='s3-root-path'
                type='text'
                placeholder='readest'
                className='input input-bordered eink-bordered h-11 w-full text-sm focus:outline-none'
                spellCheck='false'
                value={rootPath}
                onChange={(e) => setRootPath(e.target.value)}
              />
            </div>

            <div className='flex justify-end pt-1'>
              <button
                type='submit'
                disabled={
                  isConnecting || !endpoint || !accessKeyId || !secretAccessKey || !bucketName
                }
                className={clsx(
                  'btn btn-primary',
                  'h-10 min-h-10 rounded-lg border-0 px-5 text-sm font-medium',
                  'focus-visible:ring-primary/40 focus-visible:outline-none focus-visible:ring-2',
                  isConnecting && 'opacity-60',
                )}
              >
                {isConnecting ? (
                  <span className='loading loading-spinner loading-sm' />
                ) : (
                  _('Connect')
                )}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default S3Form;
