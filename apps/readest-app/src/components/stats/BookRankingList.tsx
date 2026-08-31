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

const BookRankingList: React.FC<BookRankingListProps> = ({
  ranking,
  totalSeconds,
  onShowBookDetails,
}) => {
  const _ = useTranslation();
  const base = Math.max(1, totalSeconds);

  if (ranking.length === 0) return null;

  return (
    <ul className='divide-base-200/60 divide-y'>
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
                'flex w-full items-center gap-3 rounded-lg py-3 text-start',
                row.book && onShowBookDetails
                  ? 'hover:bg-base-200 cursor-pointer'
                  : 'cursor-default',
              )}
            >
              <span
                className={clsx(
                  'w-5 shrink-0 text-center text-sm font-semibold tabular-nums',
                  index < 3 ? 'text-primary/90' : 'text-neutral-content/45',
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
                {authors && <p className='text-neutral-content/65 mt-0.5 truncate text-xs'>{authors}</p>}
                <div className='bg-base-content/8 mt-2 h-0.5 w-full max-w-28 overflow-hidden rounded-full'>
                  <div
                    className='bg-primary/45 h-full rounded-full'
                    style={{ width: `${share}%` }}
                  />
                </div>
              </div>
              <div className='shrink-0 text-end'>
                <span className='text-sm font-semibold tabular-nums'>
                  {formatReadingDuration(row.seconds, _)}
                </span>
                <span className='text-neutral-content/45 mt-0.5 block text-[10px] tabular-nums'>
                  {share}%
                </span>
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
};

export default BookRankingList;
