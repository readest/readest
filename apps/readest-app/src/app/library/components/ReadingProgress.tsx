import type React from 'react';
import { memo, useMemo } from 'react';
import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { SHOW_UNREAD_STATUS_BADGE } from '@/services/constants';
import StatusBadge from './StatusBadge';
import { getDisplayedTimeRemaining } from '../utils/libraryUtils';

interface ReadingProgressProps {
  book: Book;
  showTimeRemaining: boolean;
}

const getProgressPercentage = (book: Book) => {
  if (!book.progress || !book.progress[1]) {
    return null;
  }
  if (book.progress && book.progress[1] === 1) {
    return 100;
  }
  const percentage = Math.round((book.progress[0] / book.progress[1]) * 100);
  return Math.max(0, Math.min(100, percentage));
};

const ReadingProgress: React.FC<ReadingProgressProps> = memo(
  ({ book, showTimeRemaining }) => {
    const _ = useTranslation();
    const progressPercentage = useMemo(() => getProgressPercentage(book), [book]);

    const minutes = getDisplayedTimeRemaining(book);
    const formatTimeLeft = (total: number) => {
      if (total < 60) return _('{{minutes}}m left', { minutes: total });
      const hours = total / 60;
      // One decimal below 10h (1.6h), whole hours above it (23h) — a tenth of an
      // hour stops being meaningful once there are dozens of them left.
      const rounded = hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours);
      return _('{{hours}}h left', { hours: rounded });
    };
    const progressLabel =
      showTimeRemaining && minutes
        ? `${progressPercentage}% · ${formatTimeLeft(minutes)}`
        : `${progressPercentage}%`;

    if (book.readingStatus === 'finished') {
      return (
        <div className='flex justify-start'>
          <StatusBadge status={book.readingStatus}>{_('Finished')}</StatusBadge>
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
        </div>
      );
    }

    if (book.readingStatus === 'unread') {
      if (SHOW_UNREAD_STATUS_BADGE) {
        return (
          <div className='flex justify-start'>
            <StatusBadge status={book.readingStatus}>{_('Unread')}</StatusBadge>
          </div>
        );
      } else {
        return <div className='flex justify-start'></div>;
      }
    }

    if (progressPercentage === null || Number.isNaN(progressPercentage)) {
      return <div className='flex justify-start'></div>;
    }

    return (
      <div
        className='text-neutral-content/70 flex min-w-0 justify-between text-xs'
        role='status'
        aria-label={`${progressPercentage}%`}
      >
        <span className='truncate'>{progressLabel}</span>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.book.updatedAt === nextProps.book.updatedAt &&
      prevProps.book.readingStatus === nextProps.book.readingStatus &&
      prevProps.showTimeRemaining === nextProps.showTimeRemaining
    );
  },
);

ReadingProgress.displayName = 'ReadingProgress';

export default ReadingProgress;
