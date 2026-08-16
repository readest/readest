import React from 'react';
import {
  MdDownloadForOffline,
  MdOfflinePin,
  MdOutlineFileDownload,
  MdOutlineSchedule,
  MdStop,
} from 'react-icons/md';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import type { ChapterDownloadStatus } from '@/services/tts/downloadChapters';

interface DownloadBadgeProps {
  // Cache status of the chapter (how much audio is on device).
  status: ChapterDownloadStatus;
  // Queue-row state, when the chapter is part of a download.
  active: boolean;
  queued: boolean;
  failed: boolean;
  // 0..1 while active; drives the ring. Ignored otherwise.
  progress: number;
  isEink: boolean;
  chapterLabel: string;
  disabled?: boolean;
  onDownload: () => void;
  onCancel: () => void;
}

// The one expressive control of the podcast sheet: a circular badge that
// changes shape with state so it reads without relying on color (needed on
// e-ink). Download tray -> stop-in-a-progress-ring while active -> waiting
// clock while queued -> resume arc for a partial or failed chapter -> filled
// offline pin when complete. Tapping a queued row removes it from the queue,
// mirroring the Spotify download toggle.
const DownloadBadge: React.FC<DownloadBadgeProps> = ({
  status,
  active,
  queued,
  failed,
  progress,
  isEink,
  chapterLabel,
  disabled = false,
  onDownload,
  onCancel,
}) => {
  const _ = useTranslation();
  const size = useResponsiveSize(26);

  if (active) {
    // A determinate ring around a stop square. On e-ink the ring updates only
    // as progress events land (no continuous animation), so it stays crisp.
    const r = size / 2 - 2;
    const circumference = 2 * Math.PI * r;
    return (
      <button
        type='button'
        aria-label={`${_('Stop downloading')}: ${chapterLabel}`}
        disabled={disabled}
        onClick={onCancel}
        className='touch-target relative flex shrink-0 items-center justify-center'
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} className='rotate-[-90deg]'>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill='none'
            strokeWidth={2}
            className='stroke-base-300'
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill='none'
            strokeWidth={2}
            strokeLinecap='round'
            className={isEink ? 'stroke-base-content' : 'stroke-primary'}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.max(0, Math.min(1, progress)))}
          />
        </svg>
        <MdStop className='absolute' size={size * 0.42} />
      </button>
    );
  }

  if (queued) {
    // Waiting in line behind another chapter; tap to leave the queue.
    return (
      <button
        type='button'
        aria-label={`${_('Remove from queue')}: ${chapterLabel}`}
        disabled={disabled}
        onClick={onCancel}
        className={clsx('touch-target flex shrink-0 items-center justify-center rounded-full')}
        style={{ width: size, height: size }}
      >
        <MdOutlineSchedule size={size} className='text-base-content/70' />
      </button>
    );
  }

  const [Icon, label, tone, onClick] =
    status === 'complete'
      ? [MdOfflinePin, _('Downloaded'), isEink ? 'text-base-content' : 'text-primary', null]
      : failed || status === 'partial'
        ? [MdDownloadForOffline, _('Resume download'), 'text-base-content/70', onDownload]
        : [MdOutlineFileDownload, _('Download chapter'), 'text-base-content/70', onDownload];

  return (
    <button
      type='button'
      aria-label={`${label}: ${chapterLabel}`}
      disabled={status === 'complete' || disabled}
      onClick={onClick ?? undefined}
      className={clsx(
        'touch-target flex shrink-0 items-center justify-center rounded-full',
        status !== 'complete' && 'not-eink:hover:bg-base-200',
      )}
      style={{ width: size, height: size }}
    >
      <Icon size={size} className={tone} />
    </button>
  );
};

export default DownloadBadge;
