import type React from 'react';
import { memo, useMemo } from 'react';
import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { SHOW_UNREAD_STATUS_BADGE } from '@/services/constants';
import StatusBadge from './StatusBadge';
import {
  getDisplayedTimeRemaining,
  getProgressPercentage,
  formatTimeLeft,
} from '../utils/libraryUtils';
import { useMedianPageDurationSecs } from '@/hooks/useMedianPageDurationSecs';

interface ReadingProgressProps {
  book: Book;
  showTimeRemaining: boolean;
  /** Shown after the progress when the shelf shows page counts. */
  pageCount?: number;
}

const ReadingProgress: React.FC<ReadingProgressProps> = memo(
  ({ book, showTimeRemaining, pageCount }) => {
    const _ = useTranslation();
    const progressPercentage = useMemo(() => getProgressPercentage(book), [book]);
    const medianPageDurationSecs = useMedianPageDurationSecs(book.hash) ?? undefined;
    const minutes = getDisplayedTimeRemaining(book, medianPageDurationSecs);
    const pagesLabel = pageCount ? _('{{count}} pages', { count: pageCount }) : '';
    const progressLabel =
      showTimeRemaining && minutes
        ? `${progressPercentage}% · ${formatTimeLeft(minutes, _)}`
        : `${progressPercentage}%`;
    const pages = pagesLabel && (
      <span className='text-neutral-content/70 truncate text-xs'>{pagesLabel}</span>
    );

    if (book.readingStatus === 'finished') {
      return (
        <div className='flex min-w-0 items-center justify-start gap-2'>
          <StatusBadge status={book.readingStatus}>{_('Finished')}</StatusBadge>
          {pages}
        </div>
      );
    }

    if (book.readingStatus === 'abandoned') {
      return (
        <div
          className='text-neutral-content/70 flex items-center justify-between gap-2 text-xs'
          role='status'
        >
          <StatusBadge status={book.readingStatus}>{_('On hold')}</StatusBadge>
          {progressPercentage !== null && !Number.isNaN(progressPercentage) && (
            <span>{progressPercentage}%</span>
          )}
          {pages}
        </div>
      );
    }

    if (book.readingStatus === 'unread') {
      if (SHOW_UNREAD_STATUS_BADGE) {
        return (
          <div className='flex min-w-0 items-center justify-start gap-2'>
            <StatusBadge status={book.readingStatus}>{_('Unread')}</StatusBadge>
            {pages}
          </div>
        );
      } else {
        return <div className='flex min-w-0 justify-start'>{pages}</div>;
      }
    }

    if (progressPercentage === null || Number.isNaN(progressPercentage)) {
      return <div className='flex min-w-0 justify-start'>{pages}</div>;
    }

    return (
      <div
        className='text-neutral-content/70 flex min-w-0 justify-between gap-2 text-xs'
        role='status'
        aria-label={`${progressPercentage}%`}
      >
        <span className='truncate'>{progressLabel}</span>
        {pages}
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.book.updatedAt === nextProps.book.updatedAt &&
      prevProps.book.readingStatus === nextProps.book.readingStatus &&
      prevProps.showTimeRemaining === nextProps.showTimeRemaining &&
      prevProps.pageCount === nextProps.pageCount
    );
  },
);

ReadingProgress.displayName = 'ReadingProgress';

export default ReadingProgress;
