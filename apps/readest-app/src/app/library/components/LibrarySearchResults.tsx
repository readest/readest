import clsx from 'clsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { useTranslation } from '@/hooks/useTranslation';
import {
  createLibrarySearchSession,
  resolveSearchResultCfi,
  searchLibraryBooks,
} from '@/services/librarySearchService';
import type {
  Book,
  LibrarySearchConfig,
  LibrarySearchMatch,
  LibrarySearchSectionResult,
  SearchExcerpt,
} from '@/types/book';
import type { AppService } from '@/types/system';
import { addLibrarySearchHistory } from '../utils/searchHistory';

interface LibrarySearchResultsProps {
  appService: AppService;
  books: Book[];
  query: string;
  config: LibrarySearchConfig;
  onSelectResult: (book: Book, cfi: string) => void;
  onProgress?: (value: number | null) => void;
}

interface ResultGroup {
  book: Book;
  sections: LibrarySearchSectionResult[];
  matchCount: number;
  truncated?: boolean;
}

interface SearchIssue {
  book: Book;
  message: string;
}

// Errors about the query itself (not any particular book); rendered as a
// banner without book attribution.
const QUERY_LEVEL_CODES = new Set([
  'INVALID_REGEX',
  'NEARBY_NEEDS_TWO_WORDS',
  'FUZZY_QUERY_TOO_LONG',
]);

// Snapshot of the last completed scan, module-scoped so that opening a result
// in the reader and navigating back restores the results (and which groups
// were expanded) instead of rescanning the library.
interface CompletedSearchSnapshot {
  searchKey: string;
  groups: ResultGroup[];
  issues: SearchIssue[];
  skipped: number;
  truncated: boolean;
  expandedBooks: string[];
}
let completedSearchSnapshot: CompletedSearchSnapshot | null = null;

const Emphasis = ({ children }: { children: React.ReactNode }) => (
  <strong className='search-term-highlight'>{children}</strong>
);

const Excerpt = ({ excerpt }: { excerpt: SearchExcerpt }) => (
  <span>
    {excerpt.pre}
    {excerpt.segments ? (
      excerpt.segments.map((segment, index) =>
        segment.emphasized ? (
          <Emphasis key={index}>{segment.text}</Emphasis>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )
    ) : (
      <Emphasis>{excerpt.match}</Emphasis>
    )}
    {excerpt.post}
  </span>
);

// Small cover thumbnail with a lettered placeholder underneath; the image
// hides itself on error so the placeholder shows through.
const ResultCover = ({ book }: { book: Book }) => (
  <span
    aria-hidden='true'
    className='bg-base-200 eink-bordered relative flex h-10 w-7 shrink-0 items-center justify-center overflow-hidden rounded'
  >
    <span className='text-base-content/50 text-[10px] font-semibold'>
      {(book.title ?? '').trim().charAt(0)}
    </span>
    {book.coverImageUrl && (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={book.coverImageUrl}
        alt=''
        loading='lazy'
        className='absolute inset-0 h-full w-full object-cover'
        onError={(event) => {
          event.currentTarget.style.display = 'none';
        }}
      />
    )}
  </span>
);

const ResultGroupMatches = memo(
  ({
    book,
    sections,
    onSelectResult,
  }: {
    book: Book;
    sections: LibrarySearchSectionResult[];
    onSelectResult: (book: Book, match: LibrarySearchMatch) => void;
  }) => (
    <div className='pb-1.5'>
      {sections.map((section, sectionIndex) => (
        <div key={`${section.index}-${sectionIndex}`}>
          {section.label && (
            <h3 className='text-base-content/45 truncate px-4 pb-1 pt-2.5 text-[11px] font-medium uppercase tracking-wider'>
              {section.label}
            </h3>
          )}
          {section.subitems.map((match) => (
            <button
              key={`${match.locator.section}:${match.locator.start}:${match.locator.end}`}
              type='button'
              className={clsx(
                'not-eink:transition-colors mx-1.5 block w-[calc(100%-0.75rem)] rounded-lg px-2.5 py-2 text-start duration-150',
                'hover:bg-base-200/60 focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                'eink:border-base-content/25 eink:border-t eink:first:border-t-0 eink:rounded-none',
              )}
              onClick={() => onSelectResult(book, match)}
            >
              <span className='text-base-content/75 line-clamp-3 text-sm leading-relaxed'>
                <Excerpt excerpt={match.excerpt} />
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  ),
);
ResultGroupMatches.displayName = 'ResultGroupMatches';

const LibrarySearchResults = ({
  appService,
  books,
  query,
  config,
  onSelectResult,
  onProgress,
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
  const [skipped, setSkipped] = useState(0);
  // Mirrors of the accumulating states, captured into the snapshot on completion.
  const groupsRef = useRef<ResultGroup[]>([]);
  const issuesRef = useRef<SearchIssue[]>([]);
  const skippedRef = useRef(0);
  const [queryIssue, setQueryIssue] = useState('');
  const [phase, setPhase] = useState<'searching' | 'completed' | 'cancelled'>('searching');
  const [truncated, setTruncated] = useState(false);
  const [activeBook, setActiveBook] = useState('');
  const [expandedBooks, setExpandedBooks] = useState<Set<string>>(() => new Set());
  booksRef.current = books;
  configRef.current = config;
  translateRef.current = _;
  // Key on content identity only: opening a result bumps the book's progress
  // timestamp and its recency-sort position, and neither changes what a
  // rescan would find — index staleness is handled per book at search time.
  const booksKey = books
    .map((book) => book.hash)
    .sort()
    .join('|');
  const configKey = [
    config.mode,
    config.matchCase,
    config.matchDiacritics,
    config.nearbyWords,
  ].join(':');
  const searchKey = `${booksKey}\0${configKey}\0${query}`;
  const activeSearchKeyRef = useRef(searchKey);

  useEffect(() => {
    activeSearchKeyRef.current = searchKey;
    controllerRef.current?.abort();
    const snapshot = completedSearchSnapshot;
    if (snapshot && snapshot.searchKey === searchKey) {
      groupsRef.current = snapshot.groups;
      issuesRef.current = snapshot.issues;
      skippedRef.current = snapshot.skipped;
      setGroups(snapshot.groups);
      setIssues(snapshot.issues);
      setSkipped(snapshot.skipped);
      setQueryIssue('');
      setPhase('completed');
      setTruncated(snapshot.truncated);
      setActiveBook('');
      setExpandedBooks(new Set(snapshot.expandedBooks));
      onProgressRef.current?.(null);
      lastQueryRef.current = query;
      return;
    }
    const controller = new AbortController();
    controllerRef.current = controller;
    groupsRef.current = [];
    issuesRef.current = [];
    skippedRef.current = 0;
    setGroups([]);
    setIssues([]);
    setSkipped(0);
    setQueryIssue('');
    onProgressRef.current?.(0);
    setPhase('searching');
    setTruncated(false);
    setActiveBook('');
    setExpandedBooks(new Set());

    const delay = lastQueryRef.current === query ? 0 : 250;
    const timeout = setTimeout(async () => {
      for await (const event of searchLibraryBooks(appService, booksRef.current, query, {
        config: configRef.current,
        signal: controller.signal,
        session,
      })) {
        if (controller.signal.aborted) return;
        if (event.type === 'book-started') setActiveBook(event.book.title);
        else if (event.type === 'progress') {
          onProgressRef.current?.(Math.round(event.progress * 100));
        } else if (event.type === 'result') {
          setGroups((current) => {
            const existing = current.find(({ book }) => book.hash === event.book.hash);
            const next = !existing
              ? [
                  ...current,
                  {
                    book: event.book,
                    sections: [event.result],
                    matchCount: event.result.subitems.length,
                  },
                ]
              : current.map((group) =>
                  group.book.hash === event.book.hash
                    ? {
                        ...group,
                        sections: [...group.sections, event.result],
                        matchCount: group.matchCount + event.result.subitems.length,
                      }
                    : group,
                );
            groupsRef.current = next;
            return next;
          });
          await new Promise((resolve) => setTimeout(resolve, 0));
        } else if (event.type === 'book-skipped') {
          skippedRef.current += 1;
          setSkipped(skippedRef.current);
        } else if (event.type === 'book-completed' && event.truncated) {
          setGroups((current) => {
            const next = current.map((group) =>
              group.book.hash === event.book.hash ? { ...group, truncated: true } : group,
            );
            groupsRef.current = next;
            return next;
          });
        } else if (event.type === 'book-error') {
          if (event.code && QUERY_LEVEL_CODES.has(event.code)) {
            setQueryIssue(
              event.code === 'INVALID_REGEX'
                ? translateRef.current('Invalid regular expression')
                : event.code === 'NEARBY_NEEDS_TWO_WORDS'
                  ? translateRef.current('Enter at least two words')
                  : translateRef.current('Search query is too long'),
            );
            controller.abort();
            setPhase('completed');
            onProgressRef.current?.(null);
          } else {
            issuesRef.current = [...issuesRef.current, { book: event.book, message: event.error }];
            setIssues(issuesRef.current);
          }
        } else if (event.type === 'completed') {
          onProgressRef.current?.(null);
          setActiveBook('');
          setPhase('completed');
          setTruncated(Boolean(event.truncated));
          completedSearchSnapshot = {
            searchKey,
            groups: groupsRef.current,
            issues: issuesRef.current,
            skipped: skippedRef.current,
            truncated: Boolean(event.truncated),
            expandedBooks: [],
          };
          if (event.matchCount > 0) addLibrarySearchHistory(query);
        }
      }
    }, delay);
    lastQueryRef.current = query;

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [appService, searchKey, session]);

  const onProgressRef = useRef(onProgress);
  onProgressRef.current = onProgress;
  useEffect(
    () => () => {
      onProgressRef.current?.(null);
      void session.close();
    },
    [session],
  );

  const isCurrentSearch = activeSearchKeyRef.current === searchKey;
  const displayedGroups = isCurrentSearch ? groups : [];
  const displayedIssues = isCurrentSearch ? issues : [];
  const displayedSkipped = isCurrentSearch ? skipped : 0;
  const displayedQueryIssue = isCurrentSearch ? queryIssue : '';
  const displayedPhase = isCurrentSearch ? phase : 'searching';
  const displayedActiveBook = isCurrentSearch ? activeBook : '';
  const displayedTruncated = isCurrentSearch && truncated;
  const totalMatches = displayedGroups.reduce((total, group) => total + group.matchCount, 0);

  const toggleBook = (bookHash: string) => {
    setExpandedBooks((current) => {
      const next = new Set(current);
      if (!next.delete(bookHash)) next.add(bookHash);
      if (completedSearchSnapshot?.searchKey === activeSearchKeyRef.current) {
        completedSearchSnapshot.expandedBooks = [...next];
      }
      return next;
    });
  };
  const cancel = () => {
    controllerRef.current?.abort();
    setPhase('cancelled');
    setActiveBook('');
    onProgressRef.current?.(null);
  };

  // Results carry text-offset locators; the CFI is resolved lazily here so
  // searching itself never has to keep section DOMs alive.
  const handleSelectResult = useCallback(
    async (book: Book, match: LibrarySearchMatch) => {
      const cfi = await resolveSearchResultCfi(session, book, match.locator);
      onSelectResult(book, cfi ?? '');
    },
    [onSelectResult, session],
  );

  return (
    <div className='search-results flex h-full min-h-0 flex-col font-sans'>
      <div className='px-4 pb-3 pt-1 sm:px-6'>
        <div
          className='text-base-content/60 flex h-6 items-center gap-2 text-xs'
          role='status'
          aria-live='polite'
        >
          {displayedPhase === 'searching' && (
            <>
              <span className='min-w-0 flex-1 truncate'>
                {displayedActiveBook
                  ? _('Searching {{title}}', { title: displayedActiveBook })
                  : _('Searching...')}
              </span>
              <button
                type='button'
                className='hover:text-base-content not-eink:transition-colors shrink-0 font-medium duration-150'
                onClick={cancel}
              >
                {_('Cancel')}
              </button>
            </>
          )}
          {displayedPhase === 'completed' && totalMatches > 0 && (
            <span className='truncate'>
              {displayedTruncated
                ? _('{{count}}+ results', { count: totalMatches })
                : _('{{count}} results', { count: totalMatches })}
            </span>
          )}
          {displayedPhase === 'cancelled' && <span>{_('Search stopped')}</span>}
        </div>
      </div>
      <div
        aria-busy={displayedPhase === 'searching'}
        className='min-h-0 flex-1 overflow-y-auto px-4 sm:px-6'
        style={{
          paddingBottom:
            'calc(var(--now-playing-inset, 0px) + var(--safe-area-inset-bottom, 0px) + 0.75rem)',
        }}
      >
        {displayedQueryIssue && (
          <div className='bg-base-200/50 text-base-content/80 eink-bordered mb-3 rounded-lg px-4 py-3 text-sm'>
            {displayedQueryIssue}
          </div>
        )}
        <div className='space-y-3'>
          {displayedGroups.map((group) => {
            const isExpanded = expandedBooks.has(group.book.hash);
            return (
              <section key={group.book.hash}>
                {/* The sticky element is a square strip painted with the page
                    backdrop (bg-base-200, bg-base-100 in eink, matching the
                    library page), so content scrolling beneath cannot show
                    through the rounded corner notches of the card frame inside. */}
                <header className='eink:bg-base-100 bg-base-200 sticky top-0 z-[1]'>
                  <div
                    className={clsx(
                      'border-base-200 eink:border-base-content bg-base-100 rounded-t-xl border',
                      isExpanded ? 'border-b-0' : 'rounded-b-xl',
                    )}
                  >
                    <button
                      type='button'
                      aria-expanded={isExpanded}
                      aria-label={_('{{title}}, {{count}} results', {
                        title: group.book.title,
                        count: group.matchCount,
                      })}
                      className={clsx(
                        'not-eink:transition-colors flex min-h-14 w-full items-center gap-3 rounded-t-xl px-3 py-2 text-start duration-150',
                        'hover:bg-base-200/60 focus-visible:ring-base-content/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset',
                        !isExpanded && 'rounded-b-xl',
                      )}
                      onClick={() => toggleBook(group.book.hash)}
                    >
                      <ResultCover book={group.book} />
                      <span className='min-w-0 flex-1 leading-tight'>
                        <span className='text-base-content block truncate text-sm font-medium leading-5'>
                          {group.book.title}
                        </span>
                        <span className='text-base-content/55 mt-0.5 block truncate text-xs leading-4'>
                          {group.book.author}
                        </span>
                      </span>
                      <span className='bg-base-200 text-base-content/60 eink-bordered shrink-0 rounded-full px-2 py-0.5 text-xs tabular-nums'>
                        {group.matchCount}
                        {group.truncated && '+'}
                      </span>
                      <svg
                        viewBox='0 0 10 6'
                        width='10'
                        height='6'
                        aria-hidden='true'
                        className={clsx(
                          'text-base-content/40 not-eink:transition-transform shrink-0 duration-150',
                          isExpanded ? 'rotate-180' : 'rotate-0',
                        )}
                        fill='none'
                        stroke='currentColor'
                        strokeWidth='1.5'
                        strokeLinecap='round'
                        strokeLinejoin='round'
                      >
                        <polyline points='1 1, 5 5, 9 1' />
                      </svg>
                    </button>
                  </div>
                </header>
                {isExpanded && (
                  <div className='border-base-200 eink:border-base-content bg-base-100 rounded-b-xl border border-t-0'>
                    <ResultGroupMatches
                      book={group.book}
                      sections={group.sections}
                      onSelectResult={handleSelectResult}
                    />
                  </div>
                )}
              </section>
            );
          })}
        </div>
        {displayedSkipped > 0 && (
          <p className='text-base-content/50 mt-4 text-center text-xs' role='status'>
            {_('{{count}} books unavailable', { count: displayedSkipped })}
          </p>
        )}
        {displayedIssues.length > 0 && (
          <div className='text-base-content/50 mt-3 space-y-1 px-1 text-xs'>
            {displayedIssues.map(({ book, message }) => (
              <p key={`${book.hash}-${message}`} className='truncate'>
                <span className='font-medium'>{book.title}</span>
                {' · '}
                {message}
              </p>
            ))}
          </div>
        )}
        {displayedPhase === 'completed' &&
          totalMatches === 0 &&
          displayedIssues.length === 0 &&
          !displayedQueryIssue && (
            <div className='flex flex-col items-center gap-1 py-16 text-center' role='status'>
              <p className='text-base-content/70 text-sm font-medium'>{_('No results found')}</p>
              <p className='text-base-content/50 text-xs'>
                {_('Try a different term or search mode')}
              </p>
            </div>
          )}
      </div>
    </div>
  );
};

export default LibrarySearchResults;
