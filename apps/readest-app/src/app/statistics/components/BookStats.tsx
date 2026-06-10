'use client';

import { useState, useMemo } from 'react';
import { PiClock, PiCalendar, PiCaretDown, PiBook } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { BookStatistics } from '@/types/statistics';
import { Book } from '@/types/book';

interface BookStatsProps {
  bookStats: Record<string, BookStatistics>;
}

type SortField = 'lastReadAt' | 'totalReadingTime' | 'totalSessions';
type SortOrder = 'asc' | 'desc';

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

interface BookStatsItemProps {
  book: Book | undefined;
  stats: BookStatistics;
}

const BookStatsItem: React.FC<BookStatsItemProps> = ({ book, stats }) => {
  const _ = useTranslation();

  return (
    <div className='bg-base-100 hover:bg-base-100/80 flex items-center gap-3 rounded-lg p-3 transition-colors'>
      {/* Book cover or placeholder */}
      <div className='bg-base-300 flex h-16 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded'>
        {book?.coverImageUrl ? (
          <img src={book.coverImageUrl} alt={book.title} className='h-full w-full object-cover' />
        ) : (
          <PiBook className='text-base-content/30' size={24} />
        )}
      </div>

      {/* Book info */}
      <div className='min-w-0 flex-1'>
        <h4 className='text-base-content truncate text-sm font-medium'>
          {book?.title || _('Unknown Book')}
        </h4>
        <p className='text-base-content/60 truncate text-xs'>{book?.author || '-'}</p>

        <div className='mt-1 flex items-center gap-3 text-xs'>
          <span className='text-base-content/50 flex items-center gap-1'>
            <PiClock size={12} />
            {formatDuration(stats.totalReadingTime)}
          </span>
          <span className='text-base-content/50 flex items-center gap-1'>
            <PiCalendar size={12} />
            {formatDate(stats.lastReadAt)}
          </span>
          {stats.completedAt && (
            <span className='badge badge-success badge-xs'>{_('Completed')}</span>
          )}
        </div>
      </div>

      {/* Stats summary */}
      <div className='text-right'>
        <div className='text-base-content text-sm font-semibold'>
          {stats.totalSessions} {stats.totalSessions === 1 ? _('session') : _('sessions')}
        </div>
        <div className='text-base-content/50 text-xs'>
          {_('Avg: {{duration}}', { duration: formatDuration(stats.averageSessionDuration) })}
        </div>
      </div>
    </div>
  );
};

const BookStats: React.FC<BookStatsProps> = ({ bookStats }) => {
  const _ = useTranslation();
  const { library } = useLibraryStore();
  const [sortField, setSortField] = useState<SortField>('lastReadAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [showAll, setShowAll] = useState(false);

  const bookMap = useMemo(() => {
    const map = new Map<string, Book>();
    library.forEach((book) => map.set(book.hash, book));
    return map;
  }, [library]);

  const sortedBooks = useMemo(() => {
    const entries = Object.entries(bookStats);

    entries.sort((a, b) => {
      const [, statsA] = a;
      const [, statsB] = b;

      let comparison = 0;
      switch (sortField) {
        case 'lastReadAt':
          comparison = statsA.lastReadAt - statsB.lastReadAt;
          break;
        case 'totalReadingTime':
          comparison = statsA.totalReadingTime - statsB.totalReadingTime;
          break;
        case 'totalSessions':
          comparison = statsA.totalSessions - statsB.totalSessions;
          break;
      }

      return sortOrder === 'desc' ? -comparison : comparison;
    });

    return entries;
  }, [bookStats, sortField, sortOrder]);

  const displayedBooks = showAll ? sortedBooks : sortedBooks.slice(0, 5);

  const handleSortChange = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc');
    } else {
      setSortField(field);
      setSortOrder('desc');
    }
  };

  if (sortedBooks.length === 0) {
    return (
      <div className='bg-base-200 rounded-xl p-4'>
        <h3 className='text-base-content mb-4 font-semibold'>{_('Books Read')}</h3>
        <div className='py-8 text-center'>
          <PiBook size={48} className='text-base-content/20 mx-auto mb-2' />
          <p className='text-base-content/50 text-sm'>{_('No reading history yet')}</p>
          <p className='text-base-content/40 text-xs'>
            {_('Start reading to see your book statistics')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='bg-base-200 rounded-xl p-4'>
      <div className='mb-4 flex items-center justify-between'>
        <h3 className='text-base-content font-semibold'>
          {_('Books Read')} ({sortedBooks.length})
        </h3>

        {/* Sort dropdown */}
        <div className='dropdown dropdown-end'>
          <button className='btn btn-ghost btn-xs gap-1'>
            {sortField === 'lastReadAt'
              ? _('Recent')
              : sortField === 'totalReadingTime'
                ? _('Time')
                : _('Sessions')}
            <PiCaretDown size={12} />
          </button>
          <ul className='menu dropdown-content bg-base-300 rounded-box z-10 w-32 p-2 shadow'>
            <li>
              <button
                className={sortField === 'lastReadAt' ? 'active' : ''}
                onClick={() => handleSortChange('lastReadAt')}
              >
                {_('Recent')}
              </button>
            </li>
            <li>
              <button
                className={sortField === 'totalReadingTime' ? 'active' : ''}
                onClick={() => handleSortChange('totalReadingTime')}
              >
                {_('Time Spent')}
              </button>
            </li>
            <li>
              <button
                className={sortField === 'totalSessions' ? 'active' : ''}
                onClick={() => handleSortChange('totalSessions')}
              >
                {_('Sessions')}
              </button>
            </li>
          </ul>
        </div>
      </div>

      {/* Book list */}
      <div className='space-y-2'>
        {displayedBooks.map(([bookHash, stats]) => (
          <BookStatsItem key={bookHash} book={bookMap.get(bookHash)} stats={stats} />
        ))}
      </div>

      {/* Show more button */}
      {sortedBooks.length > 5 && (
        <button className='btn btn-ghost btn-sm mt-4 w-full' onClick={() => setShowAll(!showAll)}>
          {showAll ? _('Show less') : _('Show all ({{count}})', { count: sortedBooks.length })}
        </button>
      )}
    </div>
  );
};

export default BookStats;
