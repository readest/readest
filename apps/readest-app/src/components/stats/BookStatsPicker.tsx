import React from 'react';
import { BoxedList, NavigationRow } from '@/components/settings/primitives';
import { useTranslation, type TranslationFunc } from '@/hooks/useTranslation';
import type { BookStats, StatBook } from '@/types/statistics';
import { formatDate } from '@/utils/book';
import { formatDuration } from '@/utils/duration';

/** "3h 20m · November 19, 2026": an entry's reading time and when it was last read. */
export const describeBookStats = (book: BookStats, _: TranslationFunc) =>
  `${formatDuration(Math.floor(book.seconds / 60), _)} · ${formatDate(book.lastRead * 1000) ?? ''}`;

export const toStatBook = (book: BookStats): StatBook => ({
  bookMd5: book.md5,
  title: book.title,
  authors: book.authors,
});

interface BookStatsPickerProps {
  /** What picking an entry does, e.g. "Merge “Dune” into:". */
  prompt: string;
  books: BookStats[];
  /** Entries with this title come first: they are the likely duplicates. */
  title: string;
  onPick: (book: BookStats) => void;
  onCancel: () => void;
}

/** Picks the other entry of a merge (#7494). */
const BookStatsPicker: React.FC<BookStatsPickerProps> = ({
  prompt,
  books,
  title,
  onPick,
  onCancel,
}) => {
  const _ = useTranslation();
  const key = (t: string) => t.trim().toLowerCase();
  const sameTitle = (book: BookStats) => (key(book.title) === key(title) ? 0 : 1);
  const sorted = [...books].sort((a, b) => sameTitle(a) - sameTitle(b));

  return (
    <div data-merge-picker className='flex flex-col gap-2'>
      <p className='text-base-content/70 text-sm'>{prompt}</p>
      {sorted.length > 0 ? (
        <BoxedList>
          {sorted.map((book) => (
            <NavigationRow
              key={book.md5}
              title={book.title}
              status={describeBookStats(book, _)}
              onClick={() => onPick(book)}
              className='pe-0 text-start'
            />
          ))}
        </BoxedList>
      ) : (
        <p className='text-base-content/70 text-sm'>
          {_('No other books have reading statistics')}
        </p>
      )}
      <button
        type='button'
        className='min-h-11 cursor-pointer self-start text-sm focus-visible:outline-2 focus-visible:outline-offset-2'
        onClick={onCancel}
      >
        {_('Cancel')}
      </button>
    </div>
  );
};

export default BookStatsPicker;
