import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { MdArrowBackIosNew, MdArrowForwardIos, MdChevronRight } from 'react-icons/md';
import Dialog from '@/components/Dialog';
import BookCover from '@/components/BookCover';
import { BoxedList, NavigationRow, SettingsRow } from '@/components/settings/primitives';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { flushPageStats } from '@/services/statistics/pageFlush';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import { getDailySeconds, getStreaks, toDateKey } from '@/services/statistics/readingStats';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import type { BookReadingStat } from '@/types/statistics';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';
import { getDirFromUILanguage } from '@/utils/rtl';
import ReadingTimeChart from './ReadingTimeChart';
import ReadingHeatmap from './ReadingHeatmap';

/** Books shown in the dashboard before the rest moves behind "View All". */
const SUMMARY_BOOKS = 5;
/** Books rendered per page in the full list. */
const BOOKS_PAGE = 30;

export const setReadingStatsDialogVisible = (visible: boolean) => {
  const dialog = document.getElementById('reading_stats_window');
  if (dialog) {
    const event = new CustomEvent('setDialogVisibility', {
      detail: { visible },
    });
    dialog.dispatchEvent(event);
  }
};

interface ReadingStats {
  daily: Map<string, number>;
  totals: { seconds: number; books: number; pages: number };
  books: BookReadingStat[];
}

interface ReadingStatsContentProps {
  /** Open a book from the list; rows are non-interactive when omitted. */
  onOpenBook?: (book: Book) => void;
}

const ReadingStatsContent: React.FC<ReadingStatsContentProps> = ({ onOpenBook }) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { user } = useAuth();
  const library = useLibraryStore((s) => s.library);
  const hashIndex = useLibraryStore((s) => s.hashIndex);
  const [stats, setStats] = useState<ReadingStats | null>(null);
  const [failed, setFailed] = useState(false);
  // The dashboard keeps a short book list; the full list is a pane in the same
  // dialog so the page never grows with the size of the library.
  const [view, setView] = useState<'summary' | 'all-books'>('summary');
  const [query, setQuery] = useState('');
  const [visibleBooks, setVisibleBooks] = useState(BOOKS_PAGE);
  const rootRef = useRef<HTMLDivElement>(null);
  const summaryScrollTop = useRef(0);
  const restoreScroll = useRef(false);
  const isRtl = getDirFromUILanguage() === 'rtl';
  const BackIcon = isRtl ? MdArrowForwardIos : MdArrowBackIosNew;

  // The dialog's scroll container is the OverlayScrollbars viewport above this
  // pane; walk up to it so switching views can start at the top and return to
  // where the dashboard was left.
  const scrollContainer = () => {
    let el = rootRef.current?.parentElement ?? null;
    while (el && el.tagName !== 'DIALOG') {
      if (el.scrollHeight > el.clientHeight) return el;
      el = el.parentElement;
    }
    return null;
  };
  const scrollTo = (top: number) => {
    const el = scrollContainer();
    if (el) el.scrollTop = top;
  };

  useEffect(() => {
    if (view === 'all-books') {
      const frame = requestAnimationFrame(() => scrollTo(0));
      return () => cancelAnimationFrame(frame);
    }
    if (restoreScroll.current) {
      restoreScroll.current = false;
      const frame = requestAnimationFrame(() => scrollTo(summaryScrollTop.current));
      return () => cancelAnimationFrame(frame);
    }
    return undefined;
  }, [view]);

  useEffect(() => {
    if (!appService) return;
    let cancelled = false;
    const load = async (db: StatisticsDb) => {
      const [quarters, totals, books] = await Promise.all([
        db.getQuarterHourDurations(),
        db.getReadingTotals(),
        db.getBookStats(),
      ]);
      if (!cancelled) setStats({ daily: getDailySeconds(quarters), totals, books });
    };
    StatisticsDb.open(appService)
      .then(async (db) => {
        // Flush the page currently on screen first: a book opened moments ago
        // then reaches the list with its time, not only its opening marker.
        await flushPageStats();
        await load(db);
        // Only an open book pulls stats, so from the library this device may
        // not have the account's other devices yet: show what's here, then pull.
        if (user && isSyncCategoryEnabled('stats')) {
          // Loaded here so the menus that import this dialog don't pull the
          // sync client (and its API base URL) into their module graph.
          const [{ SyncClient }, { pullStats }] = await Promise.all([
            import('@/libs/sync'),
            import('@/services/statistics/statsSync'),
          ]);
          await pullStats(db, new SyncClient()).catch((err) =>
            console.warn('Failed to pull reading stats:', err),
          );
          await load(db);
        }
      })
      .catch((err) => {
        console.error('Failed to load reading stats:', err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [appService, user]);

  if (failed) {
    return (
      <p className='text-base-content/70 py-10 text-center'>
        {_('Failed to load reading statistics')}
      </p>
    );
  }
  if (!stats) return null;

  const { daily, totals, books } = stats;
  const streaks = getStreaks(daily);
  const locale = getLocale();
  const time = (seconds: number) => formatDuration(Math.floor(seconds / 60), _);
  const days = (count: number) => _('{{count}} days', { count });
  const libraryBookFor = (md5: string) => {
    const index = hashIndex.get(md5);
    return index === undefined ? undefined : library[index];
  };
  const lastRead = (seconds: number) => {
    const date = new Date(seconds * 1000);
    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    };
    return _('Last read {{date}}', { date: date.toLocaleDateString(locale, options) });
  };
  const bookCount = () => _('{{count}} books', { count: books.length });

  const openAllBooks = () => {
    summaryScrollTop.current = scrollContainer()?.scrollTop ?? 0;
    setQuery('');
    setVisibleBooks(BOOKS_PAGE);
    setView('all-books');
  };
  const backToSummary = () => {
    restoreScroll.current = true;
    setView('summary');
  };

  const renderBookRow = (book: BookReadingStat) => {
    const libraryBook = libraryBookFor(book.bookMd5);
    const canOpen = !!(libraryBook && !libraryBook.deletedAt && onOpenBook);
    const percent =
      book.totalPages > 0
        ? Math.max(0, Math.min(100, Math.round((book.furthestPage / book.totalPages) * 100)))
        : null;
    const rowClassName = clsx(
      'flex min-h-32 w-full items-start gap-4 pe-4 py-2 text-start',
      canOpen &&
        'hover:bg-base-200/60 focus-visible:ring-base-content/15 cursor-pointer transition-colors duration-150 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset',
    );
    const content = (
      <>
        {libraryBook ? (
          <div className='eink-bordered aspect-28/41 h-28 shrink-0 overflow-hidden rounded-xs'>
            <BookCover book={libraryBook} mode='list' coverFit='crop' imageClassName='rounded-xs' />
          </div>
        ) : (
          <div className='bg-base-200 text-base-content/60 eink-bordered flex aspect-28/41 h-28 shrink-0 items-center justify-center rounded-xs text-base font-medium'>
            {(book.title || '?').slice(0, 1).toLocaleUpperCase(locale)}
          </div>
        )}
        <div className='flex min-w-0 flex-1 flex-col gap-1.5'>
          <div className='flex min-w-0 flex-col'>
            <span
              title={book.title || book.bookMd5}
              className='text-base-content line-clamp-1 text-base font-semibold'
            >
              {book.title || book.bookMd5}
            </span>
            <div className='flex min-w-0 items-baseline justify-between gap-3'>
              <span className='text-base-content/65 line-clamp-1 min-w-0 text-[0.8em] leading-snug'>
                {book.authors}
              </span>
              <span className='text-base-content/65 shrink-0 text-[0.8em] leading-snug tabular-nums'>
                {lastRead(book.lastRead)}
              </span>
            </div>
          </div>
          <div className='mt-0.5 flex items-baseline justify-between gap-3'>
            <span className='tabular-nums'>{time(book.seconds)}</span>
            {percent !== null && (
              <span className='text-base-content/65 text-[0.8em] tabular-nums'>{percent}%</span>
            )}
          </div>
          {percent !== null && (
            <div
              role='progressbar'
              aria-label={book.title || book.bookMd5}
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className='bg-base-300 h-1.5 w-full overflow-hidden rounded-full'
            >
              <div
                className='bg-base-content/70 h-full rounded-full'
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>
        {canOpen && (
          <span className='text-base-content/45 flex w-5 shrink-0 items-center justify-center self-center'>
            <MdChevronRight className='h-5 w-5' />
          </span>
        )}
      </>
    );
    return canOpen ? (
      <button
        key={book.bookMd5}
        type='button'
        onClick={() => {
          if (libraryBook && onOpenBook) onOpenBook(libraryBook);
        }}
        aria-label={book.title || book.bookMd5}
        className={rowClassName}
      >
        {content}
      </button>
    ) : (
      <div key={book.bookMd5} className={rowClassName}>
        {content}
      </div>
    );
  };

  if (view === 'all-books') {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    const matchingBooks = normalizedQuery
      ? books.filter((book) =>
          `${book.title} ${book.authors}`.toLocaleLowerCase(locale).includes(normalizedQuery),
        )
      : books;
    return (
      <div ref={rootRef} className='flex flex-col gap-4 pb-6'>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            onClick={backToSummary}
            className='btn btn-ghost btn-sm px-1'
            aria-label={_('Back')}
            title={_('Back')}
          >
            <BackIcon className='h-4 w-4' />
          </button>
          <span className='text-base font-semibold tracking-tight'>{_('All Books')}</span>
          <span className='text-base-content/65 ms-auto text-[0.85em] tabular-nums'>
            {bookCount()}
          </span>
        </div>
        <input
          type='search'
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleBooks(BOOKS_PAGE);
          }}
          placeholder={_('Search Books...')}
          aria-label={_('Search Books')}
          spellCheck={false}
          autoComplete='off'
          className='input eink-bordered bg-base-200 h-10 w-full rounded-full border-0 px-4 text-sm focus:outline-hidden'
        />
        {matchingBooks.length === 0 ? (
          <p className='text-base-content/65 py-8 text-center'>
            {_('No matching books found. Try a different title or author.')}
          </p>
        ) : (
          <BoxedList>{matchingBooks.slice(0, visibleBooks).map(renderBookRow)}</BoxedList>
        )}
        {visibleBooks < matchingBooks.length && (
          <button
            type='button'
            onClick={() => setVisibleBooks((count) => count + BOOKS_PAGE)}
            className='btn btn-ghost self-center'
          >
            {_('Load more')}
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className='flex flex-col gap-6 pb-6'>
      <BoxedList title={_('Reading Time')} innerClassName='pe-4 py-4'>
        <ReadingTimeChart daily={daily} />
      </BoxedList>
      <BoxedList title={_('Activity')} innerClassName='pe-4 py-4'>
        <ReadingHeatmap daily={daily} />
      </BoxedList>
      {books.length > 0 && (
        <BoxedList title={_('Books')}>
          {books.slice(0, SUMMARY_BOOKS).map(renderBookRow)}
          {books.length > SUMMARY_BOOKS && (
            <NavigationRow title={_('View All')} status={bookCount()} onClick={openAllBooks} />
          )}
        </BoxedList>
      )}
      <BoxedList title={_('Overview')}>
        <SettingsRow label={_('Today')}>
          <span className='tabular-nums'>{time(daily.get(toDateKey(new Date())) ?? 0)}</span>
        </SettingsRow>
        <SettingsRow label={_('Current Streak')}>
          <span className='tabular-nums'>{days(streaks.current)}</span>
        </SettingsRow>
        <SettingsRow label={_('Longest Streak')}>
          <span className='tabular-nums'>{days(streaks.longest)}</span>
        </SettingsRow>
      </BoxedList>
      <BoxedList title={_('All Time')}>
        <SettingsRow label={_('Reading Time')}>
          <span className='tabular-nums'>{time(totals.seconds)}</span>
        </SettingsRow>
        <SettingsRow label={_('Books')}>
          <span className='tabular-nums'>{totals.books.toLocaleString(getLocale())}</span>
        </SettingsRow>
        <SettingsRow label={_('Pages')}>
          <span className='tabular-nums'>{totals.pages.toLocaleString(getLocale())}</span>
        </SettingsRow>
      </BoxedList>
    </div>
  );
};

export interface ReadingStatsDialogProps {
  /** Open a book from the statistics list; omit to keep the rows static. */
  onOpenBook?: (book: Book) => void;
}

export const ReadingStatsDialog: React.FC<ReadingStatsDialogProps> = ({ onOpenBook }) => {
  const _ = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleCustomEvent = (event: CustomEvent) => {
      setIsOpen(event.detail.visible);
    };

    const el = document.getElementById('reading_stats_window');
    if (el) {
      el.addEventListener('setDialogVisibility', handleCustomEvent as EventListener);
    }

    return () => {
      if (el) {
        el.removeEventListener('setDialogVisibility', handleCustomEvent as EventListener);
      }
    };
  }, []);

  return (
    <Dialog
      id='reading_stats_window'
      isOpen={isOpen}
      title={_('Reading Statistics')}
      onClose={() => setIsOpen(false)}
      useOverlayScroll
      boxClassName='sm:h-[85%]! sm:w-[560px]! sm:max-w-(--breakpoint-sm)!'
      contentClassName='px-4! sm:px-6!'
    >
      {isOpen && <ReadingStatsContent onOpenBook={onOpenBook} />}
    </Dialog>
  );
};

export default ReadingStatsDialog;
