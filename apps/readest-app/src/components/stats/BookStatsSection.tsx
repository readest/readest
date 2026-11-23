import clsx from 'clsx';
import React, { useCallback, useEffect, useState } from 'react';
import { MdExpandLess, MdExpandMore } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { saveSysSettings } from '@/helpers/settings';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { useSettingsStore } from '@/store/settingsStore';
import type { Book } from '@/types/book';
import type { BookStats, StatBook } from '@/types/statistics';
import { formatDate } from '@/utils/book';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';
import BookStatsAlert, { type BookStatsAction } from './BookStatsAlert';
import BookStatsPicker, { toStatBook } from './BookStatsPicker';

interface BookStatsSectionProps {
  book: Pick<Book, 'hash' | 'title' | 'author'>;
}

const TEXT_ACTION =
  'min-h-11 cursor-pointer text-sm focus-visible:outline-2 focus-visible:outline-offset-2';

/**
 * Book Details: this book's reading statistics (#7494). They can be deleted,
 * and another entry (the same book read under another file) merged into them.
 */
const BookStatsSection: React.FC<BookStatsSectionProps> = ({ book }) => {
  const _ = useTranslation();
  const { appService, envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const [db, setDb] = useState<StatisticsDb | null>(null);
  // undefined while loading, null when the book has no statistics
  const [stats, setStats] = useState<BookStats | null | undefined>(undefined);
  // the other entries, while one is picked to merge into this book
  const [others, setOthers] = useState<BookStats[] | null>(null);
  const [action, setAction] = useState<BookStatsAction | null>(null);
  const collapsed = settings.metadataStatsCollapsed;
  // Keep the statistics' own title and authors; a book never read has none yet.
  const target: StatBook = stats
    ? toStatBook(stats)
    : { bookMd5: book.hash, title: book.title, authors: book.author };

  const load = useCallback(async () => {
    if (!appService) return;
    const opened = await StatisticsDb.open(appService);
    const [entry] = await opened.getBookStats(book.hash);
    setDb(opened);
    setStats(entry ?? null);
  }, [appService, book.hash]);

  useEffect(() => {
    load().catch((err) => console.error('Failed to load book statistics:', err));
  }, [load]);

  const toggleCollapse = () => {
    saveSysSettings(envConfig, 'metadataStatsCollapsed', !collapsed);
  };

  const pickMergeSource = async () => {
    if (!db) return;
    const all = await db.getBookStats();
    setOthers(all.filter((b) => b.md5 !== book.hash));
  };

  const mergeAction = (
    <button
      type='button'
      className={TEXT_ACTION}
      onClick={() =>
        void pickMergeSource().catch((err) => console.error('Failed to load statistics:', err))
      }
    >
      {_('Merge Statistics')}
    </button>
  );

  return (
    <div className='metadata-stats'>
      <button
        className={clsx(
          'flex w-full items-center justify-between px-4 py-3 text-start transition-colors',
          collapsed ? 'hover:bg-base-200 rounded-lg' : '',
        )}
        onClick={toggleCollapse}
      >
        <span className='text-neutral-content/85 text-base font-semibold'>
          {_('Reading Statistics')}
        </span>
        {collapsed ? <MdExpandMore className='h-5 w-5' /> : <MdExpandLess className='h-5 w-5' />}
      </button>
      {!collapsed && stats !== undefined && (
        <div className='px-4 py-1'>
          {others ? (
            <BookStatsPicker
              prompt={_('Merge another entry into this book:')}
              books={others}
              title={target.title}
              onPick={(source) =>
                setAction({ type: 'merge', sources: [toStatBook(source)], target })
              }
              onCancel={() => setOthers(null)}
            />
          ) : stats ? (
            <div className='grid grid-cols-2 gap-4 sm:grid-cols-3'>
              <div className='overflow-hidden'>
                <span className='font-bold'>{_('Reading Time')}</span>
                <p className='text-neutral-content text-sm'>
                  {formatDuration(Math.floor(stats.seconds / 60), _)}
                </p>
              </div>
              <div className='overflow-hidden pe-1 text-end sm:text-start'>
                <span className='font-bold'>{_('Pages Read')}</span>
                <p className='text-neutral-content text-sm'>
                  {stats.pages.toLocaleString(getLocale())}
                </p>
              </div>
              <div className='overflow-hidden'>
                <span className='font-bold'>{_('Last Read')}</span>
                <p className='text-neutral-content text-sm'>
                  {formatDate(stats.lastRead * 1000) ?? ''}
                </p>
              </div>
              <div className='col-span-2 flex gap-6 sm:col-span-3'>
                {mergeAction}
                <button
                  type='button'
                  className={clsx(TEXT_ACTION, 'text-error')}
                  onClick={() => setAction({ type: 'delete', books: [target] })}
                >
                  {_('Delete Statistics')}
                </button>
              </div>
            </div>
          ) : (
            <div className='flex flex-col items-start'>
              <p className='text-neutral-content text-sm'>{_('No reading statistics yet')}</p>
              {mergeAction}
            </div>
          )}
        </div>
      )}
      {action && db && (
        <BookStatsAlert
          db={db}
          action={action}
          onClose={() => setAction(null)}
          onDone={() => {
            setOthers(null);
            void load();
          }}
        />
      )}
    </div>
  );
};

export default BookStatsSection;
