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
import { restoreFromBackupZip, saveBackupFile } from '@/services/backupService';
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

  const resetState = () => {
    setStatus('idle');
    setProgress({ current: 0, total: 0 });
    setErrorMessage('');
    setResult(null);
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
      const timestamp = new Date().toISOString().slice(0, 10);
      const filename = `readest-backup-${timestamp}.zip`;
      const saved = await saveBackupFile(appService, filename, (current, total, currentFile) => {
        setProgress({ current, total, currentFile });
      });
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

      const { booksAdded, booksUpdated } = await restoreFromBackupZip(
        appService,
        zipFile,
        (current, total, currentFile) => {
          setProgress({ current, total, currentFile });
        },
      );

      const newLibrary = await appService.loadLibraryBooks();
      const booksCount = newLibrary.reduce((sum, book) => sum + (book.deletedAt ? 0 : 1), 0);
      setLibrary(newLibrary);
      setResult({
        type: 'restore',
        booksAdded: Math.min(booksAdded, booksCount),
        booksUpdated: Math.min(booksUpdated, booksCount),
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

  const isProcessing = status === 'backing-up' || status === 'restoring';

  return (
    <Dialog
      id='backup_window'
      isOpen={isOpen}
      title={_('Backup & Restore')}
      onClose={handleClose}
      snapHeight={appService?.isMobile ? 0.45 : undefined}
      dismissible={!isProcessing}
      boxClassName='sm:!w-[520px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='backup-content flex flex-col gap-6 px-6 py-4'>
          {/* Action Buttons */}
          {status === 'idle' && (
            <div className='space-y-3'>
              <p className='text-base-content/70 text-sm'>
                {_(
                  'Create a backup of your library or restore from a previous backup. Restoring will merge with your current library.',
                )}
              </p>

              <button className='btn btn-outline w-full gap-2' onClick={handleBackup}>
                <RiUploadCloud2Line className='h-5 w-5' />
                {_('Backup Library')}
              </button>

              <button className='btn btn-outline w-full gap-2' onClick={handleRestore}>
                <RiDownloadCloud2Line className='h-5 w-5' />
                {_('Restore Library')}
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
                    ? _('Your library has been saved to the selected location.')
                    : _('{{added}} books added, {{updated}} books updated.', {
                        added: result.booksAdded ?? 0,
                        updated: result.booksUpdated ?? 0,
                      })}
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
