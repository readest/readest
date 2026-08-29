'use client';

import React from 'react';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import BookCover from '@/components/BookCover';
import type { Book } from '@/types/book';
import type { RankedBook } from '@/hooks/useReadingStats';
import { formatReadingDuration } from '@/utils/stats';

interface BookRankingListProps {
  ranking: RankedBook[];
  /** Share-of-total base; usually the period's total seconds. */
  totalSeconds: number;
  onShowBookDetails?: (book: Book) => void;
}

/**
 * WeChat-Reading style per-book reading-time ranking for the selected period.
 * Rows come from statistics.db (deleted books still rank); only rows matching
 * a library book get a real cover and open the details dialog.
 */
const BookRankingList: React.FC<BookRankingListProps> = ({
  ranking,
  totalSeconds,
  onShowBookDetails,
}) => {
  const _ = useTranslation();
  const base = Math.max(1, totalSeconds);

  if (ranking.length === 0) {
    return (
      <p className='text-neutral-content py-6 text-center text-sm'>{_('No reading history yet')}</p>
    );
  }

  return (
    <ul className='divide-base-200/70 divide-y'>
      {ranking.map((row, index) => {
        const share = Math.min(100, Math.round((row.seconds / base) * 100));
        const title = row.title || _('Unknown Book');
        const authors = row.book?.author || row.authors;
        return (
          <li key={row.key}>
            <button
              type='button'
              disabled={!row.book || !onShowBookDetails}
              onClick={() => row.book && onShowBookDetails?.(row.book)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg py-2.5 text-start',
                row.book && onShowBookDetails
                  ? 'hover:bg-base-200 cursor-pointer'
                  : 'cursor-default',
              )}
            >
              <span
                className={clsx(
                  'w-5 shrink-0 text-center text-sm font-semibold',
                  index < 3 ? 'text-primary' : 'text-neutral-content/60',
                )}
              >
                {index + 1}
              </span>
              <div className='h-14 w-10 shrink-0 overflow-hidden rounded-sm shadow-sm'>
                {row.book ? (
                  <BookCover book={row.book} />
                ) : (
                  <div
                    aria-hidden
                    className='bg-base-200 text-base-content/40 flex h-full w-full items-center justify-center text-base font-bold'
                  >
                    {title.slice(0, 1)}
                  </div>
                )}
              </div>
              <div className='min-w-0 flex-1'>
                <div className='flex items-center gap-1.5'>
                  <span className='truncate text-sm font-medium'>{title}</span>
                  {row.versions > 1 && (
                    <span className='bg-base-200 text-neutral-content shrink-0 rounded-full px-1.5 py-0.5 text-[10px] leading-none'>
                      {_('{{count}} versions', { count: row.versions })}
                    </span>
                  )}
                </div>
                {authors && <p className='text-neutral-content/70 truncate text-xs'>{authors}</p>}
                <div className='bg-base-200/80 mt-1.5 h-1 w-full max-w-40 overflow-hidden rounded-full'>
                  <div
                    className='bg-primary/70 h-full rounded-full'
                    style={{ width: `${share}%` }}
                  />
                </div>
              </div>
              <span className='shrink-0 text-sm font-semibold tabular-nums'>
                {formatReadingDuration(row.seconds, _)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default BookRankingList;
