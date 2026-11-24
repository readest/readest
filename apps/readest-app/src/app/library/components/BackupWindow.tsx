import clsx from 'clsx';
import React, { useEffect, useState } from 'react';
import {
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Line,
  RiUploadCloud2Line,
  RiDownloadCloud2Line,
} from 'react-icons/ri';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useFileSelector } from '@/hooks/useFileSelector';
import { useScreenWakeLock } from '@/hooks/useScreenWakeLock';
import { restoreFromBackupZip, saveBackupFile } from '@/services/backupService';
import { toDateKey } from '@/services/statistics/readingStats';
import { useLibraryStore } from '@/store/libraryStore';
import Dialog from '@/components/Dialog';

export const setBackupDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('backup_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

type BackupStatus = 'idle' | 'backing-up' | 'restoring' | 'completed' | 'error';

interface BackupProgress {
  current: number;
  total: number;
  currentFile?: string;
}

interface BackupResult {
  type: 'backup' | 'restore';
  booksAdded?: number;
  booksUpdated?: number;
  libraryRestored?: boolean;
  settingsRestored?: boolean;
}

interface BackupWindowProps {
  onPullLibrary: (fullRefresh?: boolean, verbose?: boolean) => void;
}

export const BackupWindow: React.FC<BackupWindowProps> = ({ onPullLibrary }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { setLibrary } = useLibraryStore();
  const { selectFiles } = useFileSelector(appService, _);
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<BackupStatus>('idle');
  const [progress, setProgress] = useState<BackupProgress>({ current: 0, total: 0 });
  const [errorMessage, setErrorMessage] = useState('');
  const [result, setResult] = useState<BackupResult | null>(null);
  const [includeLibrary, setIncludeLibrary] = useState(true);
  const [includeSettings, setIncludeSettings] = useState(true);
  const [includeCredentials, setIncludeCredentials] = useState(false);

  const isProcessing = status === 'backing-up' || status === 'restoring';
  // Keep the screen on while a backup or restore runs, otherwise Android
  // suspends the app with it and the job stalls (#6291).
  useScreenWakeLock(isProcessing, appService?.hasWindow, appService?.isIOSApp);

  const resetState = () => {
    setStatus('idle');
    setProgress({ current: 0, total: 0 });
    setErrorMessage('');
    setResult(null);
    setIncludeLibrary(true);
    setIncludeSettings(true);
    setIncludeCredentials(false);
  };

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        resetState();
      }
    };

    const el = document.getElementById('backup_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  const handleBackup = async () => {
    if (!appService) return;

    setStatus('backing-up');
    setErrorMessage('');
    setProgress({ current: 0, total: 0 });

    try {
      // The user's own date: in UTC an early-morning backup carried yesterday's.
      const timestamp = toDateKey(new Date());
      const filename = `readest-backup-${timestamp}.zip`;
      const saved = await saveBackupFile(
        appService,
        filename,
        {
          includeLibrary,
          includeSettings,
          includeCredentials: includeSettings && includeCredentials,
        },
        (current, total, currentFile) => {
          setProgress({ current, total, currentFile });
        },
      );
      if (saved) {
        setResult({ type: 'backup' });
        setStatus('completed');
      } else {
        setStatus('idle');
      }
    } catch (error) {
      console.error('Backup failed:', error);
      setErrorMessage(_('Backup failed: {{error}}', { error: String(error) }));
      setStatus('error');
    }
  };

  const handleRestore = async () => {
    if (!appService) return;

    try {
      const result = await selectFiles({
        type: 'generic',
        accept: '.zip',
        extensions: ['zip'],
        dialogTitle: _('Select Backup'),
      });
      if (!result.files.length) return;

      setStatus('restoring');
      setErrorMessage('');
      setProgress({ current: 0, total: 0 });

      const zipFile = result.files[0]?.file
        ? result.files[0].file
        : await appService.openFile(result.files[0]!.path!, 'None');

      const { booksAdded, booksUpdated, libraryRestored, settingsRestored } =
        await restoreFromBackupZip(
          appService,
          zipFile,
          (current, total, currentFile) => {
            setProgress({ current, total, currentFile });
          },
          result.files[0]?.path,
        );

      const newLibrary = await appService.loadLibraryBooks();
      const booksCount = newLibrary.reduce((sum, book) => sum + (book.deletedAt ? 0 : 1), 0);
      setLibrary(newLibrary);
      setResult({
        type: 'restore',
        booksAdded: Math.min(booksAdded, booksCount),
        booksUpdated: Math.min(booksUpdated, booksCount),
        libraryRestored,
        settingsRestored,
      });
      setStatus('completed');
      onPullLibrary(true);
    } catch (error) {
      console.error('Restore failed:', error);
      setErrorMessage(_('Restore failed: {{error}}', { error: String(error) }));
      setStatus('error');
    }
  };

  const handleClose = () => {
    if (status === 'backing-up' || status === 'restoring') {
      return;
    }
    setIsOpen(false);
    resetState();
  };

  const progressPercentage =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <Dialog
      id='backup_window'
      isOpen={isOpen}
      title={_('Backup & Restore')}
      onClose={handleClose}
      snapHeight={appService?.isMobile ? 0.65 : undefined}
      dismissible={!isProcessing}
      boxClassName='sm:w-[520px]! sm:max-w-(--breakpoint-sm)! sm:h-auto'
    >
      {isOpen && (
        <div className='backup-content flex flex-col gap-6 px-6 py-4'>
          {/* Action Buttons */}
          {status === 'idle' && (
            <div className='space-y-3'>
              <p className='text-base-content/70 text-sm'>
                {_(
                  'Create a backup of your library and settings or restore from a previous backup. Restoring will merge with your current library.',
                )}
              </p>

              <div className='space-y-2'>
                <label className='flex cursor-pointer items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={includeLibrary}
                    onChange={(e) => setIncludeLibrary(e.target.checked)}
                    className='checkbox checkbox-sm shrink-0'
                  />
                  <span className='text-sm'>{_('Library')}</span>
                </label>
                <label className='flex cursor-pointer items-center gap-2'>
                  <input
                    type='checkbox'
                    checked={includeSettings}
                    onChange={(e) => setIncludeSettings(e.target.checked)}
                    className='checkbox checkbox-sm shrink-0'
                  />
                  <span className='text-sm'>{_('Settings')}</span>
                </label>
                <label
                  className={clsx(
                    'ms-6 flex items-start gap-2',
                    includeSettings ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                  )}
                >
                  <input
                    type='checkbox'
                    checked={includeSettings && includeCredentials}
                    disabled={!includeSettings}
                    onChange={(e) => setIncludeCredentials(e.target.checked)}
                    className='checkbox checkbox-sm mt-0.5 shrink-0'
                  />
                  <span className='text-base-content/70 text-sm'>
                    {_(
                      'Include account credentials (sync tokens, passwords). The backup file is not encrypted.',
                    )}
                  </span>
                </label>
              </div>

              <button
                className='btn btn-outline w-full gap-2'
                onClick={handleBackup}
                disabled={!includeLibrary && !includeSettings}
              >
                <RiUploadCloud2Line className='h-5 w-5' />
                {_('Create Backup')}
              </button>

              <button className='btn btn-outline w-full gap-2' onClick={handleRestore}>
                <RiDownloadCloud2Line className='h-5 w-5' />
                {_('Restore from Backup')}
              </button>
            </div>
          )}

          {/* Progress */}
          {isProcessing && (
            <div className='space-y-3'>
              <div className='flex items-center gap-2'>
                <RiLoader2Line className='text-primary h-4 w-4 animate-spin' />
                <span className='text-base-content text-sm font-medium'>
                  {status === 'backing-up' ? _('Creating backup...') : _('Restoring library...')}
                </span>
                <span className='text-base-content/70 text-sm'>{progressPercentage}%</span>
              </div>

              <div className='bg-base-200 h-2 w-full rounded-full'>
                <div
                  className='bg-primary h-2 rounded-full transition-all duration-300'
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>

              {progress.currentFile && (
                <p
                  className='text-base-content/60 overflow-hidden font-mono text-xs'
                  style={{
                    direction: 'rtl',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {progress.currentFile}
                </p>
              )}

              <p className='text-base-content/60 text-xs'>
                {_('{{current}} of {{total}} items', {
                  current: progress.current.toLocaleString(),
                  total: progress.total.toLocaleString(),
                })}
              </p>
            </div>
          )}

          {/* Success State */}
          {status === 'completed' && result && (
            <div className='space-y-3'>
              <div className='text-success flex items-center gap-2'>
                <RiCheckboxCircleFill className='h-5 w-5' />
                <span className='font-medium'>
                  {result.type === 'backup'
                    ? _('Backup completed successfully!')
                    : _('Restore completed successfully!')}
                </span>
              </div>
              <div className='bg-success/10 border-success/20 rounded-lg border p-3'>
                <p className='text-success/80 text-sm'>
                  {result.type === 'backup'
                    ? _('Your backup has been saved to the selected location.')
                    : [
                        result.libraryRestored &&
                          _('{{added}} books added, {{updated}} books updated.', {
                            added: result.booksAdded ?? 0,
                            updated: result.booksUpdated ?? 0,
                          }),
                        result.settingsRestored && _('Settings have been restored.'),
                      ]
                        .filter(Boolean)
                        .join(' ')}
                </p>
              </div>
            </div>
          )}

          {/* Error State */}
          {status === 'error' && errorMessage && (
            <div className='space-y-2'>
              <div className='text-error flex items-center gap-2'>
                <RiErrorWarningFill className='h-5 w-5' />
                <span className='font-medium'>{_('Operation failed')}</span>
              </div>
              <div className='bg-error/10 border-error/20 rounded-lg border p-3'>
                <p className='text-error/80 break-all text-sm'>{errorMessage}</p>
              </div>
            </div>
          )}

          {/* Footer Buttons */}
          <div className='flex gap-3 pt-2'>
            {status === 'completed' || status === 'error' ? (
              <>
                <button className='btn btn-outline flex-1' onClick={handleClose}>
                  {_('Close')}
                </button>
                {status === 'error' && (
                  <button className='btn btn-primary flex-1' onClick={resetState}>
                    {_('Try Again')}
                  </button>
                )}
              </>
            ) : (
              !isProcessing && (
                <button className='btn btn-outline flex-1' onClick={handleClose}>
                  {_('Cancel')}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
};
