import type React from 'react';
import { memo, useMemo } from 'react';
import type { Book } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { SHOW_UNREAD_STATUS_BADGE } from '@/services/constants';
import StatusBadge from './StatusBadge';

interface ReadingProgressProps {
  book: Book;
}

const getProgressPercentage = (book: Book) => {
  if (!book.progress || !book.progress[1]) {
    return 0;
  }
  if (book.progress && book.progress[1] === 1) {
    return 100;
  }
  const percentage = Math.round((book.progress[0] / book.progress[1]) * 100);
  return Math.max(0, Math.min(100, percentage));
};

const ReadingProgress: React.FC<ReadingProgressProps> = memo(
  ({ book }) => {
    const _ = useTranslation();
    const progressPercentage = useMemo(() => getProgressPercentage(book), [book]);

    if (book.readingStatus === 'finished') {
      return (
        <div
          className='flex items-center justify-between gap-2.5'
          role='status'
          aria-label={_('Finished')}
        >
          <div className='h-[3px] flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]'>
            <div className='h-full w-full rounded-full bg-[#a97716]' />
          </div>
          <div className='flex items-center gap-2'>
            <span className='min-w-[2.5rem] text-right text-[10px] uppercase tracking-[0.12em] text-[#b8892f]'>
              100%
            </span>
            <StatusBadge status={book.readingStatus}>{_('Finished')}</StatusBadge>
          </div>
        </div>
      );
    }

    if (book.readingStatus === 'unread') {
      if (SHOW_UNREAD_STATUS_BADGE) {
        return (
          <div
            className='flex items-center justify-between gap-2.5'
            role='status'
            aria-label={_('Unread')}
          >
            <div className='h-[3px] flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]'>
              <div className='h-full w-0 rounded-full bg-[#a97716]' />
            </div>
            <div className='flex items-center gap-2'>
              <span className='min-w-[2.5rem] text-right text-[10px] uppercase tracking-[0.12em] text-[#b8892f]'>
                0%
              </span>
              <StatusBadge status={book.readingStatus}>{_('Unread')}</StatusBadge>
            </div>
          </div>
        );
      }

      return (
        <div className='flex items-center gap-2.5' role='status' aria-label='0%'>
          <div className='h-[3px] flex-1 rounded-full bg-[rgba(255,255,255,0.08)]'></div>
          <span className='min-w-[2.5rem] text-right text-[10px] uppercase tracking-[0.12em] text-[#b8892f]'>
            0%
          </span>
        </div>
      );
    }

    return (
      <div
        className='flex items-center gap-2.5'
        role='status'
        aria-label={`${progressPercentage}%`}
      >
        <div className='h-[3px] flex-1 overflow-hidden rounded-full bg-[rgba(255,255,255,0.08)]'>
          <div
            className='h-full rounded-full bg-[#a97716] transition-[width] duration-300'
            style={{ width: `${progressPercentage}%` }}
          />
        </div>
        <span className='min-w-[2.5rem] text-right text-[10px] uppercase tracking-[0.12em] text-[#b8892f]'>
          {progressPercentage}%
        </span>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.book.hash === nextProps.book.hash &&
      prevProps.book.updatedAt === nextProps.book.updatedAt &&
      prevProps.book.readingStatus === nextProps.book.readingStatus
    );
  },
);

ReadingProgress.displayName = 'ReadingProgress';

export default ReadingProgress;
