import React from 'react';
import { MdDownloadForOffline, MdOfflinePin, MdOutlineFileDownload, MdStop } from 'react-icons/md';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import type { ChapterDownloadStatus } from '@/services/tts/downloadChapters';

interface DownloadBadgeProps {
  status: ChapterDownloadStatus;
  active: boolean;
  // 0..1 while active; drives the ring. Ignored otherwise.
  progress: number;
  isEink: boolean;
  onDownload: () => void;
  onCancel: () => void;
}

// The one expressive control of the podcast sheet: a circular badge that
// changes shape with state so it reads without relying on color (needed on
// e-ink). Download tray -> stop-in-a-progress-ring while active -> resume
// arc for a partial chapter -> filled offline pin when complete.
const DownloadBadge: React.FC<DownloadBadgeProps> = ({
  status,
  active,
  progress,
  isEink,
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
        aria-label={_('Stop downloading')}
        onClick={onCancel}
        className='relative flex shrink-0 items-center justify-center'
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

  const [Icon, label, tone] =
    status === 'complete'
      ? [MdOfflinePin, _('Downloaded'), isEink ? 'text-base-content' : 'text-primary']
      : status === 'partial'
        ? [MdDownloadForOffline, _('Resume download'), 'text-base-content/70']
        : [MdOutlineFileDownload, _('Download chapter'), 'text-base-content/70'];

  return (
    <button
      type='button'
      aria-label={label}
      disabled={status === 'complete'}
      onClick={onDownload}
      className={clsx(
        'flex shrink-0 items-center justify-center rounded-full',
        status !== 'complete' && 'not-eink:hover:bg-base-200',
      )}
      style={{ width: size, height: size }}
    >
      <Icon size={size} className={tone} />
    </button>
  );
};

export default DownloadBadge;
