import React from 'react';
import clsx from 'clsx';
import { MdGraphicEq } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { formatBytes } from '@/utils/book';
import DownloadBadge from './DownloadBadge';
import type { UseTTSDownloadsResult } from '@/app/reader/hooks/useTTSDownloads';

interface TTSChaptersViewProps {
  downloads: UseTTSDownloadsResult;
  activeSectionIndex: number | null;
  isEink: boolean;
}

// Podcast-style episode list: every chapter is a row with a download badge.
// Downloading a chapter caches its audio for offline playback; the badge
// reflects what is already on the device.
const TTSChaptersView: React.FC<TTSChaptersViewProps> = ({
  downloads,
  activeSectionIndex,
  isEink,
}) => {
  const _ = useTranslation();
  const { chapters, statusOf, download, downloadChapter, downloadAll, cancel, cacheBytes } =
    downloads;

  const completeCount = chapters.filter((c) => statusOf(c) === 'complete').length;
  const anyIncomplete = completeCount < chapters.length;
  const busy = download.activeChapterKey !== null;

  return (
    <div className='flex w-full flex-col pb-4'>
      <div className='flex items-center justify-between gap-2 px-2 py-1'>
        <span className='text-base-content/60 text-sm sm:text-xs'>
          {_('{{done}} of {{total}} chapters offline', {
            done: completeCount,
            total: chapters.length,
          })}
          {cacheBytes > 0 ? ` · ${formatBytes(cacheBytes)}` : ''}
        </span>
        <button
          type='button'
          className='text-primary shrink-0 text-sm font-medium disabled:opacity-40 sm:text-xs'
          disabled={busy || !anyIncomplete}
          onClick={() => void downloadAll()}
        >
          {_('Download all')}
        </button>
      </div>

      <div className='flex w-full flex-col'>
        {chapters.map((chapter) => {
          const status = statusOf(chapter);
          const isActive = download.activeChapterKey === chapter.key;
          const isPlaying =
            activeSectionIndex !== null &&
            activeSectionIndex >= chapter.startSection &&
            activeSectionIndex < chapter.endSection;
          const subtitle = isActive
            ? _('Downloading {{done}}/{{total}}', { done: download.done, total: download.total })
            : status === 'complete'
              ? _('Downloaded')
              : status === 'partial'
                ? _('Partly downloaded')
                : null;

          return (
            <div
              key={chapter.key}
              className='flex w-full items-center gap-3 rounded-lg px-2 py-2'
              style={{ paddingInlineStart: `${8 + chapter.depth * 14}px` }}
            >
              <div className='flex min-w-0 flex-1 flex-col'>
                <div className='flex items-center gap-1.5'>
                  {isPlaying && (
                    <MdGraphicEq
                      className={isEink ? 'text-base-content' : 'text-primary'}
                      aria-label={_('Now playing')}
                    />
                  )}
                  <span
                    className={clsx(
                      'line-clamp-1 text-base sm:text-sm',
                      isPlaying && 'font-semibold',
                    )}
                  >
                    {chapter.label}
                  </span>
                </div>
                {subtitle && (
                  <span className='text-base-content/60 line-clamp-1 text-xs tabular-nums'>
                    {subtitle}
                  </span>
                )}
              </div>
              <DownloadBadge
                status={status}
                active={isActive}
                progress={download.total > 0 ? download.done / download.total : 0}
                isEink={isEink}
                onDownload={() => void downloadChapter(chapter)}
                onCancel={cancel}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TTSChaptersView;
