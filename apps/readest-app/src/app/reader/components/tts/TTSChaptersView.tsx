import React, { useEffect, useRef } from 'react';
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
// Downloading a chapter queues it on the persistent per-book download queue
// (Spotify-style: tapping a queued chapter removes it from the queue, tapping
// a partial/failed one resumes it); the badge reflects the queue row on top
// of what is already cached on the device.
const TTSChaptersView: React.FC<TTSChaptersViewProps> = ({
  downloads,
  activeSectionIndex,
  isEink,
}) => {
  const _ = useTranslation();
  const {
    chapters,
    statusOf,
    items,
    itemFor,
    downloadChapter,
    downloadAll,
    cancelChapter,
    cancelAll,
    clearDownloads,
    cacheBytes,
    statuses,
    clearing,
  } = downloads;

  const completeCount = chapters.filter((c) => statusOf(c) === 'complete').length;
  const anyIncomplete = completeCount < chapters.length;
  const queueCount = items.length;
  const hasExplicitDownloads = [...statuses.values()].some(
    (status) => status.pinned || status.active,
  );

  const activeRowRef = useRef<HTMLDivElement | null>(null);

  // Opening the list jumps straight to the currently playing chapter so the
  // current and next chapters are in view without manual scrolling.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView?.({ behavior: 'instant', block: 'start' });
  }, []);

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
        <div className='flex shrink-0 items-center gap-2'>
          {hasExplicitDownloads && (
            <button
              type='button'
              className='touch-target text-base-content/70 shrink-0 text-sm font-medium disabled:opacity-40 sm:text-xs'
              disabled={clearing}
              onClick={() => void clearDownloads()}
            >
              {_('Clear all')}
            </button>
          )}
          {queueCount > 0 ? (
            <button
              type='button'
              className='touch-target text-primary shrink-0 text-sm font-medium sm:text-xs'
              disabled={clearing}
              onClick={cancelAll}
            >
              {_('Cancel all ({{count}})', { count: queueCount })}
            </button>
          ) : (
            <button
              type='button'
              className='touch-target text-primary shrink-0 text-sm font-medium disabled:opacity-40 sm:text-xs'
              disabled={!anyIncomplete || clearing}
              onClick={() => void downloadAll()}
            >
              {_('Download all')}
            </button>
          )}
        </div>
      </div>

      <div className='flex w-full flex-col'>
        {chapters.map((chapter) => {
          const status = statusOf(chapter);
          const item = itemFor(chapter);
          const isActive = item?.status === 'in_progress';
          const isQueued = item?.status === 'pending';
          const isFailed = item?.status === 'failed';
          const isPlaying =
            activeSectionIndex !== null &&
            activeSectionIndex >= chapter.startSection &&
            activeSectionIndex < chapter.endSection;
          const subtitle =
            item?.status === 'in_progress'
              ? _('Downloading {{done}}/{{total}}', { done: item.done, total: item.total })
              : item?.status === 'pending'
                ? _('Waiting…')
                : item?.status === 'failed'
                  ? _('Download failed')
                  : status === 'complete'
                    ? _('Downloaded')
                    : status === 'partial'
                      ? _('Partly downloaded')
                      : null;

          return (
            <div
              key={chapter.key}
              ref={isPlaying ? activeRowRef : undefined}
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
                queued={isQueued}
                failed={isFailed}
                progress={
                  item?.status === 'in_progress' && item.total > 0 ? item.done / item.total : 0
                }
                isEink={isEink}
                chapterLabel={chapter.label}
                disabled={clearing}
                onDownload={() => void downloadChapter(chapter)}
                onCancel={() => cancelChapter(chapter)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TTSChaptersView;
