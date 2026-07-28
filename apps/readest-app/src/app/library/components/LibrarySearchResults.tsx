import clsx from 'clsx';
import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import { createLibrarySearchSession, searchLibraryBooks } from '@/services/librarySearchService';
import type { Book, BookSearchResult, LibrarySearchConfig, SearchExcerpt } from '@/types/book';
import type { AppService } from '@/types/system';

interface LibrarySearchResultsProps {
  appService: AppService;
  books: Book[];
  query: string;
  config: LibrarySearchConfig;
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
  const [session] = useState(() => createLibrarySearchSession(appService));
  const lastQueryRef = useRef<string | null>(null);
  const booksRef = useRef(books);
  const configRef = useRef(config);
  const translateRef = useRef(_);
  const [groups, setGroups] = useState<ResultGroup[]>([]);
  const [issues, setIssues] = useState<SearchIssue[]>([]);
  const [phase, setPhase] = useState<'searching' | 'completed' | 'cancelled'>('searching');
  const [progress, setProgress] = useState(0);
  const [activeBook, setActiveBook] = useState('');
  const [activeBookHash, setActiveBookHash] = useState('');
  const [collapsedBooks, setCollapsedBooks] = useState<Set<string>>(() => new Set());
  const groupRefs = useRef(new Map<string, HTMLElement>());
  booksRef.current = books;
  configRef.current = config;
  translateRef.current = _;
  const booksKey = books.map((book) => `${book.hash}:${book.updatedAt}`).join('|');
  const configKey = [
    config.mode,
    config.matchCase,
    config.matchDiacritics,
    config.nearbyWords,
  ].join(':');

  useEffect(() => {
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setGroups([]);
    setIssues([]);
    setProgress(0);
    setPhase('searching');
    setActiveBook('');
    setActiveBookHash('');
    setCollapsedBooks(new Set());

    const delay = lastQueryRef.current === query ? 0 : 250;
    const timeout = setTimeout(async () => {
      for await (const event of searchLibraryBooks(appService, booksRef.current, query, {
        config: configRef.current,
        signal: controller.signal,
        session,
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
          await new Promise((resolve) => setTimeout(resolve, 0));
        } else if (event.type === 'book-skipped') {
          setIssues((current) => [
            ...current,
            { book: event.book, message: translateRef.current('Unavailable') },
          ]);
        } else if (event.type === 'book-error') {
          const message =
            event.code === 'INVALID_REGEX'
              ? translateRef.current('Invalid regular expression')
              : event.code === 'NEARBY_NEEDS_TWO_WORDS'
                ? translateRef.current('Enter at least two words')
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
    }, delay);
    lastQueryRef.current = query;

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [appService, booksKey, configKey, query, session]);

  useEffect(
    () => () => {
      void session.close();
    },
    [session],
  );

  const totalMatches = useMemo(
    () => groups.reduce((total, group) => total + group.matchCount, 0),
    [groups],
  );
  useEffect(() => {
    setActiveBookHash((current) =>
      groups.some(({ book }) => book.hash === current) ? current : (groups[0]?.book.hash ?? ''),
    );
  }, [groups]);

  const toggleBook = (bookHash: string) => {
    setCollapsedBooks((current) => {
      const next = new Set(current);
      if (!next.delete(bookHash)) next.add(bookHash);
      return next;
    });
  };
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
      onScroll={(event) => {
        const containerTop = event.currentTarget.getBoundingClientRect().top;
        let currentHash = groups[0]?.book.hash ?? '';
        for (const group of groups) {
          const element = groupRefs.current.get(group.book.hash);
          if (!element || element.getBoundingClientRect().top > containerTop + 16) break;
          currentHash = group.book.hash;
        }
        setActiveBookHash(currentHash);
      }}
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
      <div className='flex items-start gap-1 sm:gap-2'>
        {groups.length > 1 && (
          <nav
            aria-label={_('Book results')}
            className='sticky top-2 flex w-5 shrink-0 flex-col items-center py-1'
          >
            <span aria-hidden='true' className='bg-base-content/25 absolute top-4 bottom-4 w-px' />
            {groups.map((group) => {
              const isActive = group.book.hash === activeBookHash;
              return (
                <button
                  key={group.book.hash}
                  type='button'
                  aria-label={_('Jump to {{title}}', { title: group.book.title })}
                  aria-current={isActive ? 'location' : undefined}
                  className='touch-target relative z-10 flex h-7 w-5 items-center justify-center'
                  onClick={() => {
                    groupRefs.current.get(group.book.hash)?.scrollIntoView({ block: 'start' });
                    setActiveBookHash(group.book.hash);
                  }}
                >
                  <span
                    aria-hidden='true'
                    className={clsx(
                      'border-base-content/60 bg-base-100 rounded-full border',
                      isActive ? 'bg-base-content h-2.5 w-2.5' : 'h-2 w-2',
                    )}
                  />
                </button>
              );
            })}
          </nav>
        )}
        <div className='min-w-0 flex-1 space-y-3'>
          {groups.map((group) => {
            const isActive = group.book.hash === activeBookHash;
            const isExpanded = !collapsedBooks.has(group.book.hash);
            return (
              <section
                key={group.book.hash}
                ref={(element) => {
                  if (element) groupRefs.current.set(group.book.hash, element);
                  else groupRefs.current.delete(group.book.hash);
                }}
                className={clsx(
                  'bg-base-100 eink-bordered rounded-lg border p-3',
                  isActive ? 'border-base-content/60' : 'border-base-300',
                )}
              >
                <header className={clsx(isExpanded && 'mb-2')}>
                  <button
                    type='button'
                    aria-expanded={isExpanded}
                    aria-label={_('{{title}}, {{count}} results', {
                      title: group.book.title,
                      count: group.matchCount,
                    })}
                    className='hover:bg-base-200 focus-visible:ring-base-content/20 flex w-full items-center gap-2 rounded-md text-start focus-visible:outline-none focus-visible:ring-2'
                    onClick={() => toggleBook(group.book.hash)}
                  >
                    <svg
                      viewBox='0 0 8 10'
                      width='8'
                      height='10'
                      className={clsx(
                        'text-base-content not-eink:transition-transform shrink-0',
                        isExpanded ? 'rotate-90' : 'rotate-0',
                      )}
                      fill='currentColor'
                      aria-hidden='true'
                    >
                      <polygon points='0 0, 8 5, 0 10' />
                    </svg>
                    <span className='min-w-0 flex-1'>
                      <span className='block truncate font-semibold'>{group.book.title}</span>
                      <span className='text-base-content/60 block truncate text-xs'>
                        {group.book.author}
                      </span>
                    </span>
                    <span className='text-base-content/60 shrink-0 text-xs'>
                      {group.matchCount}
                    </span>
                  </button>
                </header>
                {isExpanded && (
                  <div>
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
                  </div>
                )}
              </section>
            );
          })}
        </div>
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
