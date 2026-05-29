import clsx from 'clsx';
import { useEffect, useState } from 'react';
import {
  RiDatabase2Line,
  RiCheckboxCircleFill,
  RiErrorWarningFill,
  RiLoader2Line,
} from 'react-icons/ri';
import { documentDir, join } from '@tauri-apps/api/path';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { formatBytes } from '@/utils/book';
import {
  clearCacheEntries,
  getCacheEntries,
  getCacheStats,
  CacheClearProgress,
  CacheSource,
} from '@/utils/cache';
import { AppService } from '@/types/system';
import Dialog from '@/components/Dialog';

export const setCacheManagerDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('cache_manager_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

type CacheStatus = 'scanning' | 'idle' | 'confirming' | 'clearing' | 'done' | 'error';

/**
 * Locations Manage Cache clears (mobile only). Both iOS and Android clear the
 * app Cache and Temp bases; iOS additionally clears the `Documents/Inbox`
 * folder, where "Open in Readest" leaves already-imported book copies that
 * otherwise linger forever.
 */
const getCacheSources = async (appService: AppService): Promise<CacheSource[]> => {
  const sources: CacheSource[] = [
    { base: 'Cache', dir: '' },
    { base: 'Temp', dir: '' },
  ];
  if (appService.isIOSApp) {
    try {
      const inboxDir = await join(await documentDir(), 'Inbox');
      sources.push({ base: 'None', dir: inboxDir });
    } catch {
      // Documents dir unavailable — skip the inbox source.
    }
  }
  return sources;
};

export const CacheManagerWindow = () => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const [isOpen, setIsOpen] = useState(false);
  const [status, setStatus] = useState<CacheStatus>('scanning');
  const [count, setCount] = useState(0);
  const [size, setSize] = useState(0);
  const [progress, setProgress] = useState<CacheClearProgress>({ current: 0, total: 0 });
  const [errorMessage, setErrorMessage] = useState('');

  const scanCache = async () => {
    if (!appService) return;
    setStatus('scanning');
    setErrorMessage('');
    try {
      const entries = await getCacheEntries(appService, await getCacheSources(appService));
      const stats = getCacheStats(entries);
      setCount(stats.count);
      setSize(stats.size);
      setStatus('idle');
    } catch (error) {
      console.error('Error scanning cache:', error);
      setErrorMessage(_('Failed to read cache'));
      setStatus('error');
    }
  };

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
      if (event.detail.visible) {
        scanCache();
      }
    };

    const el = document.getElementById('cache_manager_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  const handleClearClick = () => {
    if (status === 'idle' && count > 0) {
      setStatus('confirming');
    }
  };

  const handleConfirmClear = async () => {
    if (!appService) return;
    setStatus('clearing');
    setProgress({ current: 0, total: 0 });
    try {
      const entries = await getCacheEntries(appService, await getCacheSources(appService));
      await clearCacheEntries(appService, entries, setProgress);
      await scanCache();
      setStatus('done');
    } catch (error) {
      console.error('Error clearing cache:', error);
      setErrorMessage(_('Failed to clear cache'));
      setStatus('error');
    }
  };

  const handleClose = () => {
    if (status === 'clearing') {
      return;
    }
    setIsOpen(false);
    setStatus('scanning');
    setProgress({ current: 0, total: 0 });
    setErrorMessage('');
  };

  const progressPercentage =
    progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  const primaryBtn = 'btn btn-contrast h-11 min-h-0 rounded-xl text-sm font-medium';
  const ghostBtn = clsx(
    'eink-bordered flex h-11 items-center justify-center rounded-xl border border-transparent',
    'text-base-content hover:bg-base-200 text-sm font-medium transition-colors',
    'focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2',
    'disabled:opacity-40',
  );

  const heroIcon =
    status === 'scanning' || status === 'clearing' ? (
      <RiLoader2Line className='h-7 w-7 animate-spin' />
    ) : status === 'done' ? (
      <RiCheckboxCircleFill className='text-success h-8 w-8' />
    ) : status === 'error' ? (
      <RiErrorWarningFill className='text-error h-7 w-7' />
    ) : (
      <RiDatabase2Line className='h-7 w-7' />
    );

  const heroCaption =
    status === 'scanning'
      ? _('Calculating cache size...')
      : status === 'done'
        ? _('Cache cleared')
        : status === 'error'
          ? errorMessage
          : _('{{count}} files', { count });

  return (
    <Dialog
      id='cache_manager_window'
      isOpen={isOpen}
      title={_('Manage Cache')}
      onClose={handleClose}
      boxClassName='sm:!w-[440px] sm:!max-w-screen-sm sm:h-auto'
    >
      {isOpen && (
        <div className='cache-manager-content flex flex-col gap-7 px-2 pb-2 pt-3'>
          {/* Hero stat */}
          <div className='flex flex-col items-center gap-3 text-center'>
            <div
              className='eink-bordered bg-base-200 text-base-content/80 flex h-16 w-16 items-center justify-center rounded-full'
              aria-hidden='true'
            >
              {heroIcon}
            </div>
            <div className='flex flex-col items-center gap-1'>
              <span className='text-base-content text-3xl font-bold tracking-tight tabular-nums'>
                {status === 'scanning' ? '—' : formatBytes(size)}
              </span>
              <span className='text-base-content/60 line-clamp-2 text-sm'>{heroCaption}</span>
            </div>
          </div>

          {/* Clearing progress */}
          {status === 'clearing' && (
            <div className='space-y-2'>
              <div className='bg-base-200 h-1.5 w-full overflow-hidden rounded-full'>
                <div
                  className='bg-base-content h-full rounded-full transition-all duration-300'
                  style={{ width: `${progressPercentage}%` }}
                />
              </div>
              <div className='text-base-content/55 flex items-center justify-between gap-3 text-xs'>
                <span
                  className='overflow-hidden font-mono'
                  style={{
                    direction: 'rtl',
                    textAlign: 'left',
                    whiteSpace: 'nowrap',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {progress.currentFile
                    ? _('Deleting: {{file}}', { file: progress.currentFile })
                    : _('Clearing cache...')}
                </span>
                <span className='shrink-0 tabular-nums'>{progressPercentage}%</span>
              </div>
            </div>
          )}

          {/* Confirm notice */}
          {status === 'confirming' && (
            <p className='text-base-content/60 flex items-center justify-center gap-1.5 text-center text-[13px] leading-relaxed'>
              <RiErrorWarningFill className='text-warning h-4 w-4 shrink-0' aria-hidden='true' />
              {_('This will delete all cached files. This cannot be undone.')}
            </p>
          )}

          {/* Action buttons */}
          {status === 'done' ? (
            <button className={primaryBtn} onClick={handleClose}>
              {_('Close')}
            </button>
          ) : (
            <div className='grid grid-cols-2 gap-2.5'>
              <button className={ghostBtn} onClick={handleClose} disabled={status === 'clearing'}>
                {_('Cancel')}
              </button>
              {status === 'confirming' ? (
                <button className={primaryBtn} onClick={handleConfirmClear}>
                  {_('Confirm Clear')}
                </button>
              ) : (
                <button
                  className={primaryBtn}
                  onClick={handleClearClick}
                  disabled={status !== 'idle' || count === 0}
                >
                  {status === 'clearing' ? _('Clearing...') : _('Clear Cache')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
};

export default CacheManagerWindow;
