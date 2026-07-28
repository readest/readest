import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { searchLibraryBooks } from '@/services/librarySearchService';
import type { Book, BookSearchConfig, BookSearchResult, SearchExcerpt } from '@/types/book';
import type { AppService } from '@/types/system';

interface LibrarySearchResultsProps {
  appService: AppService;
  books: Book[];
  query: string;
  config: BookSearchConfig;
  onSelectResult: (book: Book, cfi: string) => void;
  onScrollerRef?: (element: HTMLDivElement | null) => void;
}

interface ResultGroup {
  book: Book;
  sections: BookSearchResult[];
  matchCount: number;
}

interface SearchIssue {
  book: Book;
  message: string;
}

const Excerpt = ({ excerpt }: { excerpt: SearchExcerpt }) => (
  <span>
    {excerpt.pre}
    {excerpt.segments ? (
      excerpt.segments.map((segment, index) =>
        segment.emphasized ? (
          <strong key={index} className='text-bold-in-eink text-red-500'>
            {segment.text}
          </strong>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )
    ) : (
      <strong className='text-bold-in-eink text-red-500'>{excerpt.match}</strong>
    )}
    {excerpt.post}
  </span>
);

const LibrarySearchResults = ({
  appService,
  books,
  query,
  config,
  onSelectResult,
  onScrollerRef,
}: LibrarySearchResultsProps) => {
  const _ = useTranslation();
  const controllerRef = useRef<AbortController | null>(null);
  const [groups, setGroups] = useState<ResultGroup[]>([]);
  const [issues, setIssues] = useState<SearchIssue[]>([]);
  const [phase, setPhase] = useState<'searching' | 'completed' | 'cancelled'>('searching');
  const [progress, setProgress] = useState(0);
  const [activeBook, setActiveBook] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setGroups([]);
    setIssues([]);
    setProgress(0);
    setPhase('searching');
    setActiveBook('');

    const timeout = setTimeout(async () => {
      for await (const event of searchLibraryBooks(appService, books, query, {
        config,
        signal: controller.signal,
      })) {
        if (controller.signal.aborted) return;
        if (event.type === 'book-started') setActiveBook(event.book.title);
        else if (event.type === 'progress') setProgress(Math.round(event.progress * 100));
        else if (event.type === 'result') {
          setGroups((current) => {
            const existing = current.find(({ book }) => book.hash === event.book.hash);
            if (!existing) {
              return [
                ...current,
                {
                  book: event.book,
                  sections: [event.result],
                  matchCount: event.result.subitems.length,
                },
              ];
            }
            return current.map((group) =>
              group.book.hash === event.book.hash
                ? {
                    ...group,
                    sections: [...group.sections, event.result],
                    matchCount: group.matchCount + event.result.subitems.length,
                  }
                : group,
            );
          });
        } else if (event.type === 'book-skipped') {
          setIssues((current) => [...current, { book: event.book, message: _('Unavailable') }]);
        } else if (event.type === 'book-error') {
          const message =
            event.code === 'INVALID_REGEX'
              ? _('Invalid regular expression')
              : event.code === 'NEARBY_NEEDS_TWO_WORDS'
                ? _('Enter at least two words')
                : event.error;
          setIssues((current) => [...current, { book: event.book, message }]);
          if (event.code === 'INVALID_REGEX' || event.code === 'NEARBY_NEEDS_TWO_WORDS') {
            controller.abort();
            setPhase('completed');
          }
        } else if (event.type === 'completed') {
          setProgress(100);
          setActiveBook('');
          setPhase('completed');
        }
      }
    }, 500);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [appService, books, config, query, _]);

  const totalMatches = useMemo(
    () => groups.reduce((total, group) => total + group.matchCount, 0),
    [groups],
  );
  const cancel = () => {
    controllerRef.current?.abort();
    setPhase('cancelled');
    setActiveBook('');
  };

  return (
    <div
      ref={onScrollerRef}
      aria-busy={phase === 'searching'}
      className='search-results h-full overflow-y-auto px-3 py-2 font-sans sm:px-6'
      style={{ paddingBottom: 'calc(var(--now-playing-inset, 0px) + 0.5rem)' }}
    >
      {phase === 'searching' && (
        <div className='mb-2 flex items-center gap-3 py-1'>
          <progress
            aria-label={_('Library Search Progress')}
            className='progress h-0.5 max-w-32 flex-1'
            value={progress}
            max={100}
          />
          <button type='button' className='btn btn-ghost btn-sm eink-bordered' onClick={cancel}>
            {_('Cancel')}
          </button>
        </div>
      )}
      {phase === 'searching' && activeBook && (
        <p className='text-base-content/60 mb-2 truncate text-xs' role='status' aria-live='polite'>
          {_('Searching {{title}}', { title: activeBook })}
        </p>
      )}
      <div className='space-y-3'>
        {groups.map((group) => (
          <section key={group.book.hash} className='bg-base-100 eink-bordered rounded-lg p-3'>
            <header className='mb-2 flex items-baseline justify-between gap-3'>
              <div className='min-w-0'>
                <h2 className='truncate font-semibold'>{group.book.title}</h2>
                <p className='text-base-content/60 truncate text-xs'>{group.book.author}</p>
              </div>
              <span className='text-base-content/60 shrink-0 text-xs'>{group.matchCount}</span>
            </header>
            {group.sections.map((section, sectionIndex) => (
              <div key={`${section.index}-${sectionIndex}`} className='mb-2 last:mb-0'>
                {section.label && (
                  <h3 className='text-base-content/60 mb-1 truncate text-xs font-medium'>
                    {section.label}
                  </h3>
                )}
                <div className='space-y-1'>
                  {section.subitems.map((match) => (
                    <button
                      key={match.cfi}
                      type='button'
                      className='hover:bg-base-200 focus-visible:ring-base-content/20 touch-target w-full rounded-md px-2 py-2 text-start text-sm focus-visible:outline-none focus-visible:ring-2'
                      onClick={() => onSelectResult(group.book, match.cfi)}
                    >
                      <span className='line-clamp-3'>
                        <Excerpt excerpt={match.excerpt} />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      {issues.length > 0 && (
        <div className='eink-bordered border-base-300 mt-3 rounded-lg border p-3 text-xs'>
          {issues.map(({ book, message }) => (
            <p key={`${book.hash}-${message}`}>
              <span className='font-medium'>{book.title}:</span> {message}
            </p>
          ))}
        </div>
      )}
      {phase === 'completed' && totalMatches === 0 && issues.length === 0 && (
        <p className='text-base-content/60 p-6 text-center text-sm' role='status'>
          {_('No results found')}
        </p>
      )}
      {phase === 'cancelled' && (
        <p className='text-base-content/60 p-4 text-center text-sm' role='status'>
          {_('Search stopped')}
        </p>
      )}
      {phase === 'completed' && totalMatches > 0 && (
        <p className='text-base-content/60 p-3 text-center text-xs' role='status'>
          {_('{{count}} results', { count: totalMatches })}
        </p>
      )}
    </div>
  );
};

export default LibrarySearchResults;
