/**
 * Download Queue Panel Component
 * Shows active and completed downloads with progress
 */

import { useState, useEffect } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { downloadQueue, DownloadItem } from '@/services/sources/downloadQueue';
import {
  IoDownload,
  IoClose,
  IoPlay,
  IoPause,
  IoRefresh,
  IoTrash,
  IoCheckmark,
  IoWarning,
  IoChevronDown,
  IoChevronUp,
} from 'react-icons/io5';

export default function DownloadQueuePanel() {
  const _ = useTranslation();
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    // Subscribe to queue updates
    const unsubscribe = downloadQueue.subscribe(() => {
      setDownloads([...downloadQueue.getAllDownloads()]);
    });

    // Initial load
    setDownloads(downloadQueue.getAllDownloads());

    return unsubscribe;
  }, []);

  const activeDownloads = downloads.filter(
    d => d.status === 'downloading' || d.status === 'pending' || d.status === 'paused'
  );
  const completedDownloads = downloads.filter(
    d => d.status === 'completed' || d.status === 'error' || d.status === 'cancelled'
  );

  const stats = downloadQueue.getStats();

  if (downloads.length === 0) return null;

  return (
    <div className='border-base-300 fixed bottom-0 right-0 z-50 w-96 border-t bg-base-100 shadow-lg'>
      {/* Header */}
      <div
        className='flex cursor-pointer items-center justify-between bg-base-200 p-3'
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className='flex items-center gap-2'>
          <IoDownload className='h-5 w-5' />
          <span className='font-semibold'>{_('Downloads')}</span>
          {activeDownloads.length > 0 && (
            <span className='badge badge-sm badge-primary'>
              {activeDownloads.length} active
            </span>
          )}
        </div>
        <div className='flex items-center gap-2'>
          {stats.completed > 0 && (
            <span className='text-success text-xs'>{stats.completed} completed</span>
          )}
          {isExpanded ? (
            <IoChevronDown className='h-4 w-4' />
          ) : (
            <IoChevronUp className='h-4 w-4' />
          )}
        </div>
      </div>

      {/* Content */}
      {isExpanded && (
        <div className='max-h-96 overflow-y-auto p-3'>
          {/* Active downloads */}
          {activeDownloads.length > 0 && (
            <div className='mb-4'>
              <h4 className='mb-2 text-xs font-semibold'>{_('Active Downloads')}</h4>
              <div className='space-y-2'>
                {activeDownloads.map(download => (
                  <DownloadItemCard
                    key={download.id}
                    download={download}
                    onPause={() => downloadQueue.pauseDownload(download.id)}
                    onResume={() => downloadQueue.resumeDownload(download.id)}
                    onCancel={() => downloadQueue.cancelDownload(download.id)}
                    onRetry={() => downloadQueue.retryDownload(download.id)}
                    onRemove={() => downloadQueue.removeDownload(download.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Completed downloads */}
          {completedDownloads.length > 0 && (
            <div>
              <h4 className='mb-2 text-xs font-semibold'>{_('Completed')}</h4>
              <div className='space-y-2'>
                {completedDownloads.slice(0, 5).map(download => (
                  <DownloadItemCard
                    key={download.id}
                    download={download}
                    onRetry={() => downloadQueue.retryDownload(download.id)}
                    onRemove={() => downloadQueue.removeDownload(download.id)}
                  />
                ))}
                {completedDownloads.length > 5 && (
                  <p className='text-base-content/50 text-center text-xs py-2'>
                    +{completedDownloads.length - 5} more
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Actions */}
          {completedDownloads.length > 0 && (
            <div className='border-base-300 mt-4 flex justify-end gap-2 border-t pt-3'>
              <button
                onClick={() => downloadQueue.clearCompleted()}
                className='btn btn-ghost btn-xs'
              >
                <IoTrash className='h-3 w-3' />
                {_('Clear Completed')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Single download item card
 */
function DownloadItemCard({
  download,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRemove,
}: {
  download: DownloadItem;
  onPause?: () => void;
  onResume?: () => void;
  onCancel?: () => void;
  onRetry?: () => void;
  onRemove?: () => void;
}) {
  const _ = useTranslation();

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${minutes}m ${secs}s`;
  };

  return (
    <div className='border-base-300 rounded border bg-base-100 p-2'>
      {/* Title and status */}
      <div className='mb-2 flex items-start justify-between'>
        <div className='min-w-0 flex-1'>
          <p className='truncate text-sm font-medium'>{download.result.title}</p>
          <p className='text-base-content/50 truncate text-xs'>
            {download.result.sourceName}
          </p>
        </div>
        <div className='ml-2 flex items-center gap-1'>
          {download.status === 'completed' && (
            <IoCheckmark className='text-success h-4 w-4' />
          )}
          {download.status === 'error' && (
            <IoWarning className='text-error h-4 w-4' />
          )}
          {download.status === 'downloading' && (
            <button onClick={onPause} className='btn btn-ghost btn-xs'>
              <IoPause className='h-3 w-3' />
            </button>
          )}
          {download.status === 'paused' && (
            <button onClick={onResume} className='btn btn-ghost btn-xs'>
              <IoPlay className='h-3 w-3' />
            </button>
          )}
          {download.status === 'error' && (
            <button onClick={onRetry} className='btn btn-ghost btn-xs'>
              <IoRefresh className='h-3 w-3' />
            </button>
          )}
          {onCancel && ['pending', 'downloading', 'paused'].includes(download.status) && (
            <button onClick={onCancel} className='btn btn-ghost btn-xs'>
              <IoClose className='h-3 w-3' />
            </button>
          )}
          {onRemove && ['completed', 'error', 'cancelled'].includes(download.status) && (
            <button onClick={onRemove} className='btn btn-ghost btn-xs'>
              <IoTrash className='h-3 w-3' />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {download.status === 'downloading' && (
        <div className='mb-2'>
          <div className='bg-base-300 h-2 overflow-hidden rounded-full'>
            <div
              className='bg-primary h-full transition-all duration-300'
              style={{ width: `${download.progress}%` }}
            />
          </div>
          <div className='text-base-content/50 mt-1 flex justify-between text-xs'>
            <span>{Math.round(download.progress)}%</span>
            <span>
              {formatBytes(download.downloadedBytes)} / {formatBytes(download.totalBytes)}
            </span>
            <span>ETA: {formatTime(download.eta)}</span>
          </div>
        </div>
      )}

      {/* Status message */}
      {download.status === 'paused' && (
        <p className='text-warning text-xs'>{_('Paused')}</p>
      )}
      {download.status === 'error' && download.error && (
        <p className='text-error text-xs'>{download.error}</p>
      )}
      {download.status === 'completed' && (
        <p className='text-success text-xs'>{_('Download complete')}</p>
      )}
    </div>
  );
}
