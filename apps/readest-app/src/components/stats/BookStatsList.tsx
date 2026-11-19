import React, { useCallback, useEffect, useState } from 'react';
import { MdCallMerge, MdOutlineDelete } from 'react-icons/md';
import { BoxedList, SettingsRow } from '@/components/settings/primitives';
import { useTranslation } from '@/hooks/useTranslation';
import type { StatisticsDb } from '@/services/statistics/statisticsDb';
import type { BookStats } from '@/types/statistics';
import BookStatsAlert, { type BookStatsAction } from './BookStatsAlert';
import BookStatsPicker, { describeBookStats, toStatBook } from './BookStatsPicker';

interface BookStatsListProps {
  db: StatisticsDb;
  /** The list is read again whenever this changes, e.g. after the dialog's pull. */
  reloadKey: unknown;
  /** Called after the entries changed, so totals can be read again. */
  onChange: () => void;
}

/** Every book in the statistics, most recently read first; each can be merged or deleted (#7494). */
const BookStatsList: React.FC<BookStatsListProps> = ({ db, reloadKey, onChange }) => {
  const _ = useTranslation();
  const [books, setBooks] = useState<BookStats[] | null>(null);
  const [failed, setFailed] = useState(false);
  // the entry being merged into another, while its target is picked
  const [merging, setMerging] = useState<BookStats | null>(null);
  const [action, setAction] = useState<BookStatsAction | null>(null);

  const load = useCallback(() => {
    db.getBookStats()
      .then((loaded) => {
        setBooks(loaded);
        setFailed(false);
      })
      .catch((err) => {
        console.error('Failed to load book statistics:', err);
        setFailed(true);
      });
  }, [db]);

  useEffect(load, [load, reloadKey]);

  if (failed) {
    return (
      <p className='text-base-content/70 py-10 text-center'>
        {_('Failed to load reading statistics')}
      </p>
    );
  }
  if (!books) return null;
  if (books.length === 0) {
    return (
      <p className='text-base-content/70 py-10 text-center'>{_('No reading statistics yet')}</p>
    );
  }

  const alert = action && (
    <BookStatsAlert
      db={db}
      action={action}
      onClose={() => setAction(null)}
      onDone={() => {
        setMerging(null);
        load();
        onChange();
      }}
    />
  );

  if (merging) {
    return (
      <>
        <BookStatsPicker
          prompt={_('Merge “{{title}}” into:', { title: merging.title })}
          books={books.filter((b) => b.md5 !== merging.md5)}
          title={merging.title}
          onPick={(target) =>
            setAction({ type: 'merge', source: toStatBook(merging), target: toStatBook(target) })
          }
          onCancel={() => setMerging(null)}
        />
        {alert}
      </>
    );
  }

  return (
    <>
      <BoxedList>
        {books.map((book) => (
          <SettingsRow key={book.md5} label={book.title} description={describeBookStats(book, _)}>
            <div className='flex shrink-0 items-center'>
              <button
                type='button'
                className='btn btn-ghost btn-sm px-1'
                title={_('Merge Statistics')}
                aria-label={_('Merge statistics of {{title}}', { title: book.title })}
                onClick={() => setMerging(book)}
              >
                <MdCallMerge className='h-5 w-5' />
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-sm px-1'
                title={_('Delete Statistics')}
                aria-label={_('Delete statistics of {{title}}', { title: book.title })}
                onClick={() => setAction({ type: 'delete', book: toStatBook(book) })}
              >
                <MdOutlineDelete className='text-error h-5 w-5' />
              </button>
            </div>
          </SettingsRow>
        ))}
      </BoxedList>
      {alert}
    </>
  );
};

export default BookStatsList;
