import React, { useCallback, useEffect, useState } from 'react';
import { MdOutlineDelete } from 'react-icons/md';
import { BoxedList, SettingsRow } from '@/components/settings/primitives';
import { useTranslation } from '@/hooks/useTranslation';
import type { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { BookStats } from '@/types/statistics';
import { formatDate } from '@/utils/book';
import { formatDuration } from '@/utils/duration';
import DeleteBookStatsAlert from './DeleteBookStatsAlert';

interface BookStatsListProps {
  db: StatisticsDb;
  /** Called after a book's statistics were deleted, so totals can be read again. */
  onChange: () => void;
}

/** Every book in the statistics, most recently read first, each deletable (#7494). */
const BookStatsList: React.FC<BookStatsListProps> = ({ db, onChange }) => {
  const _ = useTranslation();
  const [books, setBooks] = useState<BookStats[] | null>(null);
  const [deleting, setDeleting] = useState<BookStats | null>(null);

  const load = useCallback(() => {
    db.getBookStats()
      .then(setBooks)
      .catch((err) => {
        console.error('Failed to load book statistics:', err);
        setBooks([]);
      });
  }, [db]);

  useEffect(load, [load]);

  if (!books) return null;
  if (books.length === 0) {
    return (
      <p className='text-base-content/70 py-10 text-center'>{_('No reading statistics yet')}</p>
    );
  }

  return (
    <>
      <BoxedList>
        {books.map((book) => (
          <SettingsRow
            key={book.md5}
            label={book.title}
            description={`${formatDuration(Math.floor(book.seconds / 60), _)} · ${formatDate(book.lastRead * 1000) ?? ''}`}
          >
            <button
              type='button'
              className='btn btn-ghost btn-sm shrink-0 px-1'
              title={_('Delete Statistics')}
              aria-label={_('Delete statistics of {{title}}', { title: book.title })}
              onClick={() => setDeleting(book)}
            >
              <MdOutlineDelete className='text-error h-5 w-5' />
            </button>
          </SettingsRow>
        ))}
      </BoxedList>
      {deleting && (
        <DeleteBookStatsAlert
          db={db}
          book={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            load();
            onChange();
          }}
        />
      )}
    </>
  );
};

export default BookStatsList;
