import clsx from 'clsx';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

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

const NAVIGATION_TOP_OFFSET = 8;
const ACTIVE_HEADER_OFFSET = 16;
const SCROLL_KEYS = new Set(['ArrowDown', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp']);

const revealElement = (container: HTMLElement, element: HTMLElement) => {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (elementRect.top < containerRect.top) {
    container.scrollTop -= containerRect.top - elementRect.top;
  } else if (elementRect.bottom > containerRect.bottom) {
    container.scrollTop += elementRect.bottom - containerRect.bottom;
  }
};

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

const ResultGroupMatches = memo(
  ({
    book,
    sections,
    onSelectResult,
  }: {
    book: Book;
    sections: BookSearchResult[];
    onSelectResult: (book: Book, cfi: string) => void;
  }) => (
    <div>
      {sections.map((section, sectionIndex) => (
        <div key={`${section.index}-${sectionIndex}`} className='mb-2 last:mb-0'>
          {section.label && (
            <h3 className='text-base-content/60 mb-1 truncate px-3 text-xs font-medium'>
              {section.label}
            </h3>
          )}
          <div className='space-y-1'>
            {section.subitems.map((match) => (
              <button
                key={match.cfi}
                type='button'
                className='hover:bg-base-200 focus-visible:ring-base-content/20 touch-target not-eink:transition-colors min-h-11 w-full rounded-md px-3 py-2.5 text-start text-sm leading-5 duration-150 focus-visible:outline-none focus-visible:ring-2'
                onClick={() => onSelectResult(book, match.cfi)}
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
  ),
);
ResultGroupMatches.displayName = 'ResultGroupMatches';

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
  const [truncated, setTruncated] = useState(false);
  const [progress, setProgress] = useState(0);
  const [activeBook, setActiveBook] = useState('');
  const [activeBookHash, setActiveBookHash] = useState('');
  const [collapsedBooks, setCollapsedBooks] = useState<Set<string>>(() => new Set());
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const navigatorRef = useRef<HTMLElement | null>(null);
  const groupRefs = useRef(new Map<string, HTMLElement>());
  const dotRefs = useRef(new Map<string, HTMLButtonElement>());
  // Programmatic scroll events must not overrule the dot the user just chose.
  const navigationTargetRef = useRef<string | null>(null);
  const navigationReleaseFrameRef = useRef<number | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const releaseNavigationTarget = useCallback(() => {
    navigationTargetRef.current = null;
    if (navigationReleaseFrameRef.current !== null) {
      cancelAnimationFrame(navigationReleaseFrameRef.current);
      navigationReleaseFrameRef.current = null;
    }
  }, []);
  const updateNavigatorHeight = useCallback(() => {
    const scroller = scrollerRef.current;
    const navigator = navigatorRef.current;
    if (scroller && navigator) {
      const nowPlayingInset =
        Number.parseFloat(getComputedStyle(scroller).getPropertyValue('--now-playing-inset')) || 0;
      navigator.style.maxHeight = `${Math.max(44, scroller.clientHeight - 16 - nowPlayingInset)}px`;
      const focusedDot = navigator.contains(document.activeElement)
        ? (document.activeElement as HTMLElement)
        : null;
      const activeDot = navigator.querySelector<HTMLElement>('[aria-current="location"]');
      const visibleDot = focusedDot ?? activeDot;
      if (visibleDot) revealElement(navigator, visibleDot);
    }
  }, []);
  const setScrollerRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollerRef.current = element;
      onScrollerRef?.(element);
      updateNavigatorHeight();
    },
    [onScrollerRef, updateNavigatorHeight],
  );
  const setNavigatorRef = useCallback(
    (element: HTMLElement | null) => {
      navigatorRef.current = element;
      updateNavigatorHeight();
    },
    [updateNavigatorHeight],
  );
  const revealNavigatorDot = useCallback((bookHash: string) => {
    const navigator = navigatorRef.current;
    const dot = dotRefs.current.get(bookHash);
    if (!navigator || !dot) return;
    const focusedDot = navigator.contains(document.activeElement)
      ? (document.activeElement as HTMLElement)
      : null;
    revealElement(navigator, focusedDot ?? dot);
  }, []);
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
  const searchKey = `${booksKey}\0${configKey}\0${query}`;
  const activeSearchKeyRef = useRef(searchKey);

  useEffect(() => {
    activeSearchKeyRef.current = searchKey;
    releaseNavigationTarget();
    if (scrollFrameRef.current !== null) {
      cancelAnimationFrame(scrollFrameRef.current);
      scrollFrameRef.current = null;
    }
    const controller = new AbortController();
    controllerRef.current?.abort();
    controllerRef.current = controller;
    setGroups([]);
    setIssues([]);
    setProgress(0);
    setPhase('searching');
    setTruncated(false);
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
                : event.code === 'FUZZY_QUERY_TOO_LONG'
                  ? translateRef.current('Search query is too long')
                  : event.error;
          setIssues((current) => [...current, { book: event.book, message }]);
          if (
            event.code === 'INVALID_REGEX' ||
            event.code === 'NEARBY_NEEDS_TWO_WORDS' ||
            event.code === 'FUZZY_QUERY_TOO_LONG'
          ) {
            controller.abort();
            setPhase('completed');
          }
        } else if (event.type === 'completed') {
          setProgress(100);
          setActiveBook('');
          setPhase('completed');
          setTruncated(Boolean(event.truncated));
        }
      }
    }, delay);
    lastQueryRef.current = query;

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [appService, releaseNavigationTarget, searchKey, session]);

  useEffect(
    () => () => {
      releaseNavigationTarget();
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      void session.close();
    },
    [releaseNavigationTarget, session],
  );
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    updateNavigatorHeight();
    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateNavigatorHeight);
    resizeObserver?.observe(scroller);
    const insetObserver = new MutationObserver(updateNavigatorHeight);
    insetObserver.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    return () => {
      resizeObserver?.disconnect();
      insetObserver.disconnect();
    };
  }, [updateNavigatorHeight]);

  const isCurrentSearch = activeSearchKeyRef.current === searchKey;
  const displayedGroups = isCurrentSearch ? groups : [];
  const displayedIssues = isCurrentSearch ? issues : [];
  const displayedPhase = isCurrentSearch ? phase : 'searching';
  const displayedProgress = isCurrentSearch ? progress : 0;
  const displayedActiveBook = isCurrentSearch ? activeBook : '';
  const displayedTruncated = isCurrentSearch && truncated;
  const totalMatches = displayedGroups.reduce((total, group) => total + group.matchCount, 0);
  useEffect(() => {
    setActiveBookHash((current) =>
      groups.some(({ book }) => book.hash === current) ? current : (groups[0]?.book.hash ?? ''),
    );
  }, [groups]);
  useEffect(() => {
    if (activeBookHash) revealNavigatorDot(activeBookHash);
  }, [activeBookHash, revealNavigatorDot]);

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
  const scheduleActiveBookUpdate = (scroller: HTMLDivElement) => {
    if (navigationTargetRef.current || scrollFrameRef.current !== null) return;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      if (navigationTargetRef.current || displayedGroups.length === 0) return;

      let currentHash = displayedGroups[0]!.book.hash;
      const isAtBottom =
        scroller.scrollHeight > scroller.clientHeight &&
        scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
      if (isAtBottom) {
        currentHash = displayedGroups.at(-1)!.book.hash;
      } else {
        const activeLine = scroller.getBoundingClientRect().top + ACTIVE_HEADER_OFFSET;
        for (const group of displayedGroups) {
          const element = groupRefs.current.get(group.book.hash);
          if (!element) continue;
          if (element.getBoundingClientRect().top > activeLine) break;
          currentHash = group.book.hash;
        }
      }
      setActiveBookHash((current) => (current === currentHash ? current : currentHash));
    });
  };
  const navigateToBook = (bookHash: string) => {
    const scroller = scrollerRef.current;
    const element = groupRefs.current.get(bookHash);
    if (!scroller || !element) return;

    navigationTargetRef.current = bookHash;
    setActiveBookHash(bookHash);
    scroller.scrollTop = Math.max(
      0,
      scroller.scrollTop +
        element.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        NAVIGATION_TOP_OFFSET,
    );
    if (navigationReleaseFrameRef.current !== null) {
      cancelAnimationFrame(navigationReleaseFrameRef.current);
    }
    navigationReleaseFrameRef.current = requestAnimationFrame(() => {
      navigationReleaseFrameRef.current = requestAnimationFrame(() => {
        navigationReleaseFrameRef.current = null;
        if (navigationTargetRef.current === bookHash) navigationTargetRef.current = null;
      });
    });
  };

  return (
    <div
      ref={setScrollerRef}
      aria-busy={displayedPhase === 'searching'}
      className='search-results h-full overflow-y-auto px-3 py-2 font-sans sm:px-6'
      style={{ paddingBottom: 'calc(var(--now-playing-inset, 0px) + 0.5rem)' }}
      onPointerDownCapture={releaseNavigationTarget}
      onWheelCapture={releaseNavigationTarget}
      onFocusCapture={releaseNavigationTarget}
      onKeyDownCapture={(event) => {
        if (SCROLL_KEYS.has(event.key)) releaseNavigationTarget();
      }}
      onScroll={(event) => scheduleActiveBookUpdate(event.currentTarget)}
    >
      {displayedPhase === 'searching' && (
        <div className='mb-2 flex items-center gap-3 py-1'>
          <progress
            aria-label={_('Library Search Progress')}
            className='progress h-0.5 max-w-32 flex-1'
            value={displayedProgress}
            max={100}
          />
          <button type='button' className='btn btn-ghost btn-sm eink-bordered' onClick={cancel}>
            {_('Cancel')}
          </button>
        </div>
      )}
      {displayedPhase === 'searching' && displayedActiveBook && (
        <p className='text-base-content/60 mb-2 truncate text-xs' role='status' aria-live='polite'>
          {_('Searching {{title}}', { title: displayedActiveBook })}
        </p>
      )}
      <div className='flex items-start gap-1 sm:gap-2'>
        {displayedGroups.length > 1 && (
          <nav
            ref={setNavigatorRef}
            aria-label={_('Book results')}
            className='no-scrollbar sticky top-2 w-11 shrink-0 overflow-y-auto py-1'
          >
            <div className='relative flex min-h-full w-full flex-col items-center'>
              <span
                aria-hidden='true'
                className='bg-base-content/25 absolute top-4 bottom-4 w-px'
              />
              {displayedGroups.map((group) => {
                const isActive = group.book.hash === activeBookHash;
                return (
                  <button
                    key={group.book.hash}
                    type='button'
                    aria-label={_('Jump to {{title}}', { title: group.book.title })}
                    aria-current={isActive ? 'location' : undefined}
                    className='focus-visible:ring-base-content/15 relative z-10 flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2'
                    ref={(element) => {
                      if (element) dotRefs.current.set(group.book.hash, element);
                      else dotRefs.current.delete(group.book.hash);
                    }}
                    onFocus={() => revealNavigatorDot(group.book.hash)}
                    onClick={() => navigateToBook(group.book.hash)}
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
            </div>
          </nav>
        )}
        <div className='min-w-0 flex-1 space-y-3'>
          {displayedGroups.map((group) => {
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
                  'bg-base-100 eink-bordered rounded-lg border p-2 sm:p-3',
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
                    className='group hover:bg-base-200 focus-visible:ring-base-content/20 not-eink:transition-colors flex min-h-12 w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-start duration-150 focus-visible:outline-none focus-visible:ring-2 sm:gap-3 sm:px-2.5'
                    onClick={() => toggleBook(group.book.hash)}
                  >
                    <span
                      aria-hidden='true'
                      className='bg-base-200 group-hover:bg-base-300 eink-bordered not-eink:transition-colors flex size-7 shrink-0 items-center justify-center rounded-full duration-150'
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
                      >
                        <polygon points='0 0, 8 5, 0 10' />
                      </svg>
                    </span>
                    <span className='min-w-0 flex-1 leading-tight'>
                      <span className='block truncate font-semibold leading-5'>
                        {group.book.title}
                      </span>
                      <span className='text-base-content/60 mt-0.5 block truncate text-xs leading-4'>
                        {group.book.author}
                      </span>
                    </span>
                    <span className='bg-base-200 group-hover:bg-base-300 text-base-content/70 eink-bordered not-eink:transition-colors min-w-7 shrink-0 rounded-full px-2 py-1 text-center text-xs tabular-nums duration-150'>
                      {group.matchCount}
                    </span>
                  </button>
                </header>
                {isExpanded && (
                  <ResultGroupMatches
                    book={group.book}
                    sections={group.sections}
                    onSelectResult={onSelectResult}
                  />
                )}
              </section>
            );
          })}
        </div>
      </div>
      {displayedIssues.length > 0 && (
        <div className='eink-bordered border-base-300 mt-3 rounded-lg border p-3 text-xs'>
          {displayedIssues.map(({ book, message }) => (
            <p key={`${book.hash}-${message}`}>
              <span className='font-medium'>{book.title}:</span> {message}
            </p>
          ))}
        </div>
      )}
      {displayedPhase === 'completed' && totalMatches === 0 && displayedIssues.length === 0 && (
        <p className='text-base-content/60 p-6 text-center text-sm' role='status'>
          {_('No results found')}
        </p>
      )}
      {displayedPhase === 'cancelled' && (
        <p className='text-base-content/60 p-4 text-center text-sm' role='status'>
          {_('Search stopped')}
        </p>
      )}
      {displayedPhase === 'completed' && totalMatches > 0 && (
        <p className='text-base-content/60 p-3 text-center text-xs' role='status'>
          {displayedTruncated
            ? _('Showing first {{count}} results', { count: totalMatches })
            : _('{{count}} results', { count: totalMatches })}
        </p>
      )}
    </div>
  );
};

export default LibrarySearchResults;
