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
  /** Entries are checked to merge or delete several at once (#7812). */
  selecting: boolean;
  /** Called once a merge or deletion of the checked entries is done. */
  onSelectingDone: () => void;
}

/** Every book in the statistics, most recently read first; each can be merged or deleted (#7494). */
const BookStatsList: React.FC<BookStatsListProps> = ({
  db,
  reloadKey,
  onChange,
  selecting,
  onSelectingDone,
}) => {
  const _ = useTranslation();
  const [books, setBooks] = useState<BookStats[] | null>(null);
  const [failed, setFailed] = useState(false);
  // the entries being merged into another, while their target is picked
  const [merging, setMerging] = useState<BookStats[] | null>(null);
  const [action, setAction] = useState<BookStatsAction | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  // Entering or leaving selection starts over, closing a merge being picked.
  useEffect(() => {
    setChecked(new Set());
    setMerging(null);
  }, [selecting]);

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
        onSelectingDone();
        load();
        onChange();
      }}
    />
  );

  if (merging) {
    // One entry merges into any other; checked entries merge into one of them.
    const [first] = merging;
    return (
      <>
        <BookStatsPicker
          prompt={
            merging.length === 1
              ? _('Merge “{{title}}” into:', { title: first!.title })
              : _('Merge {{count}} entries into:', { count: merging.length })
          }
          books={merging.length === 1 ? books.filter((b) => b !== first) : merging}
          title={first!.title}
          onPick={(target) =>
            setAction({
              type: 'merge',
              sources: merging.filter((b) => b !== target).map(toStatBook),
              target: toStatBook(target),
            })
          }
          onCancel={() => setMerging(null)}
        />
        {alert}
      </>
    );
  }

  if (selecting) {
    const picked = books.filter((b) => checked.has(b.md5));
    const all = picked.length === books.length;
    const toggle = (md5: string) =>
      setChecked((prev) => {
        const next = new Set(prev);
        if (!next.delete(md5)) next.add(md5);
        return next;
      });
    return (
      <>
        <div className='bg-base-100 sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-2 py-2'>
          <span className='text-base-content/70 px-1 text-sm tabular-nums'>
            {_('{{count}} selected', { count: picked.length })}
          </span>
          <button
            type='button'
            className='btn btn-ghost btn-sm px-2'
            onClick={() => setChecked(all ? new Set() : new Set(books.map((b) => b.md5)))}
          >
            {all ? _('Deselect') : _('Select All')}
          </button>
          <div className='ms-auto flex items-center gap-1'>
            <button
              type='button'
              className='btn btn-ghost btn-sm gap-1 px-2'
              disabled={picked.length < 2}
              onClick={() => setMerging(picked)}
            >
              <MdCallMerge className='h-5 w-5' />
              {_('Merge')}
            </button>
            <button
              type='button'
              className='btn btn-ghost btn-sm text-error gap-1 px-2'
              disabled={picked.length === 0}
              onClick={() => setAction({ type: 'delete', books: picked.map(toStatBook) })}
            >
              <MdOutlineDelete className='h-5 w-5' />
              {_('Delete')}
            </button>
          </div>
        </div>
        <BoxedList>
          {books.map((book) => (
            <SettingsRow
              key={book.md5}
              asLabel
              label={book.title}
              description={describeBookStats(book, _)}
            >
              <input
                type='checkbox'
                className='checkbox checkbox-sm'
                aria-label={book.title}
                checked={checked.has(book.md5)}
                onChange={() => toggle(book.md5)}
              />
            </SettingsRow>
          ))}
        </BoxedList>
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
                onClick={() => setMerging([book])}
              >
                <MdCallMerge className='h-5 w-5' />
              </button>
              <button
                type='button'
                className='btn btn-ghost btn-sm px-1'
                title={_('Delete Statistics')}
                aria-label={_('Delete statistics of {{title}}', { title: book.title })}
                onClick={() => setAction({ type: 'delete', books: [toStatBook(book)] })}
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
