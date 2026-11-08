import clsx from 'clsx';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import BookCover from '@/components/BookCover';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import type { Book } from '@/types/book';
import type { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  type BookReading,
  getCalendarDays,
  getDailyBookReadings,
  toDateKey,
} from '@/services/statistics/readingStats';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';
import { createWheelGestureDetector } from '@/app/reader/utils/wheelGesture';

interface ReadingCalendarProps {
  db: Pick<StatisticsDb, 'getBookQuarterHourDurations'>;
  /** A new map also refreshes the calendar after the account's stats are pulled. */
  daily: Map<string, number>;
}

const canAnimateMonth = (element: HTMLElement) =>
  typeof element.animate === 'function' &&
  !element.closest("[data-eink='true']") &&
  !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ReadingCalendar: React.FC<ReadingCalendarProps> = ({ db, daily }) => {
  const _ = useTranslation();
  const locale = getLocale();
  const today = toDateKey(new Date());
  const [selected, setSelected] = useState(today);
  const [month, setMonth] = useState(() => today.slice(0, 7));
  const [result, setResult] = useState<{
    month: string;
    days: Map<string, BookReading[]>;
  } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const focusDay = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const monthGridRef = useRef<HTMLDivElement>(null);
  const pendingTransition = useRef<{
    snapshot: HTMLElement;
    direction: number;
    height: number;
  } | null>(null);
  const stopTransition = useRef<(() => void) | null>(null);
  const swipe = useRef<{
    id: number;
    x: number;
    y: number;
    horizontal: boolean;
  } | null>(null);
  const suppressSwipeClick = useRef(false);
  const wheelGesture = useRef(createWheelGestureDetector({ threshold: 60 }));
  const library = useLibraryStore((state) => state.library);
  const libraryByHash = useMemo(() => new Map(library.map((book) => [book.hash, book])), [library]);
  const monthDate = new Date(`${month}-01T00:00:00`);
  const days = getCalendarDays(monthDate);

  useLayoutEffect(() => {
    const pending = pendingTransition.current;
    pendingTransition.current = null;
    const viewport = gridRef.current;
    const current = monthGridRef.current;
    if (!pending || !viewport || !current || !canAnimateMonth(viewport)) return;
    const { snapshot, direction, height } = pending;
    const nextHeight = viewport.offsetHeight;
    snapshot.removeAttribute('data-calendar-month');
    snapshot.setAttribute('data-calendar-exit', '');
    snapshot.setAttribute('aria-hidden', 'true');
    snapshot.querySelectorAll('button').forEach((button) => {
      button.tabIndex = -1;
      button.removeAttribute('data-calendar-date');
      button.removeAttribute('aria-pressed');
      button.removeAttribute('aria-current');
    });
    Object.assign(snapshot.style, {
      position: 'absolute',
      insetBlockStart: '4px',
      insetInlineStart: '4px',
      insetInlineEnd: '4px',
      pointerEvents: 'none',
    });
    viewport.append(snapshot);
    const options = { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' };
    const animations = [
      current.animate(
        [
          { transform: `translateX(${direction * 100}%)`, opacity: 0.6 },
          { transform: 'translateX(0%)', opacity: 1 },
        ],
        options,
      ),
      snapshot.animate(
        [
          { transform: 'translateX(0%)', opacity: 1 },
          { transform: `translateX(${-direction * 100}%)`, opacity: 0.3 },
        ],
        options,
      ),
    ];
    if (height !== nextHeight) {
      animations.push(
        viewport.animate([{ height: `${height}px` }, { height: `${nextHeight}px` }], options),
      );
    }
    const stop = () => {
      animations.forEach((animation) => animation.cancel());
      snapshot.remove();
      if (stopTransition.current === stop) stopTransition.current = null;
    };
    stopTransition.current = stop;
    void Promise.all(animations.map((animation) => animation.finished)).then(stop, () => {});
    return stop;
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    setResult(null);
    setFailed(false);
    const start = new Date(`${month}-01T00:00:00`);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    db.getBookQuarterHourDurations(start.getTime() / 1000, end.getTime() / 1000)
      .then((quarters) => {
        if (!cancelled) setResult({ month, days: getDailyBookReadings(quarters) });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [db, daily, month, retry]);

  useEffect(() => {
    if (focusDay.current) {
      gridRef.current
        ?.querySelector<HTMLButtonElement>(`[data-calendar-date="${selected}"]`)
        ?.focus();
      focusDay.current = false;
    }
  }, [selected]);

  const loading = !failed && result?.month !== month;
  const readings = result?.month === month ? result.days : new Map<string, BookReading[]>();
  const selectedBooks = readings.get(selected) ?? [];
  const time = (seconds: number) => formatDuration(Math.floor(seconds / 60), _);
  const formatDay = (key: string) =>
    new Date(`${key}T00:00:00`).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    });

  const coverBook = (reading: BookReading): Book => {
    const book = libraryByHash.get(reading.bookMd5);
    if (book && !book.deletedAt) return book;
    // Synced/removed books retain their history even without a local cover file.
    return {
      hash: reading.bookMd5,
      title: reading.title,
      author: reading.authors,
      format: 'EPUB',
      createdAt: 0,
      updatedAt: 0,
    };
  };

  const selectDate = useCallback(
    (key: string) => {
      if (!key || key > today) return;
      if (key.slice(0, 7) !== month) {
        stopTransition.current?.();
        const viewport = gridRef.current;
        const current = monthGridRef.current;
        // Keyboard date navigation focuses its destination immediately; keep that grid still
        // so the browser cannot scroll the viewport toward a sliding, off-screen button.
        if (viewport && current && !focusDay.current && canAnimateMonth(viewport)) {
          const direction = getComputedStyle(viewport).direction === 'rtl' ? -1 : 1;
          pendingTransition.current = {
            snapshot: current.cloneNode(true) as HTMLElement,
            direction: (key.slice(0, 7) > month ? 1 : -1) * direction,
            height: viewport.offsetHeight,
          };
        }
      }
      setSelected(key);
      setMonth(key.slice(0, 7));
    },
    [month, today],
  );

  const changeMonth = useCallback(
    (step: number) => {
      focusDay.current = false;
      const current = new Date(`${month}-01T00:00:00`);
      const next = new Date(current.getFullYear(), current.getMonth() + step, 1);
      selectDate(toDateKey(next));
    },
    [month, selectDate],
  );

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    suppressSwipeClick.current = false;
    if (
      !event.isPrimary ||
      !['touch', 'pen'].includes(event.pointerType) ||
      event.button !== 0 ||
      swipe.current
    ) {
      swipe.current = null;
      return;
    }
    swipe.current = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = swipe.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    const x = Math.abs(event.clientX - gesture.x);
    const y = Math.abs(event.clientY - gesture.y);
    if (!gesture.horizontal && y > 10 && y >= x) {
      swipe.current = null;
      return;
    }
    if (!gesture.horizontal && x > 10 && x > y * 1.5) {
      gesture.horizontal = true;
      suppressSwipeClick.current = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = swipe.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    swipe.current = null;
    const x = event.clientX - gesture.x;
    const y = event.clientY - gesture.y;
    if (gesture.horizontal && Math.abs(x) >= 50 && Math.abs(x) > Math.abs(y) * 1.5) {
      const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
      changeMonth((x < 0 ? 1 : -1) * direction);
    }
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const cancelSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
    if (swipe.current?.id === event.pointerId) swipe.current = null;
  };

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const handleTouchMove = (event: TouchEvent) => {
      if (swipe.current?.horizontal && event.touches.length === 1) event.preventDefault();
    };
    // Pointer capture alone lets Android swallow the next tap after a swipe.
    // Cancel only claimed horizontal touches; React's touchmove listener is passive.
    grid.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => grid.removeEventListener('touchmove', handleTouchMove);
  }, []);

  useEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const handleWheel = (event: WheelEvent) => {
      const x = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      const y = event.shiftKey ? 0 : event.deltaY;
      if (!x && !y) return;
      if (event.ctrlKey || event.metaKey || Math.abs(x) <= Math.abs(y) * 1.5) {
        wheelGesture.current.suppress(event.timeStamp);
        return;
      }
      event.preventDefault();
      const turn = wheelGesture.current.feed({
        deltaX: x,
        deltaY: 0,
        deltaMode: event.deltaMode,
        timeStamp: event.timeStamp,
      });
      if (turn) {
        const direction = getComputedStyle(grid).direction === 'rtl' ? -1 : 1;
        changeMonth(Math.sign(turn.deltaX) * direction);
      }
    };
    // React's wheel listener is passive; only deliberate horizontal gestures cancel scrolling.
    grid.addEventListener('wheel', handleWheel, { passive: false });
    return () => grid.removeEventListener('wheel', handleWheel);
  }, [changeMonth]);

  // Capture is necessary inside Dialog, which stops bubbling keyboard events.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-calendar-date]');
    if (!target) return;
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const steps: Record<string, number> = {
      ArrowLeft: rtl ? 1 : -1,
      ArrowRight: rtl ? -1 : 1,
      ArrowUp: -7,
      ArrowDown: 7,
    };
    const step = steps[event.key];
    if (!step) return;
    event.preventDefault();
    const next = new Date(`${selected}T00:00:00`);
    next.setDate(next.getDate() + step);
    focusDay.current = true;
    selectDate(toDateKey(next));
  };

  return (
    <div role='group' aria-label={_('Reading Calendar')} className='flex min-w-0 flex-col gap-3'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <span className='font-medium' aria-live='polite'>
          {monthDate.toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
        </span>
        <div className='flex shrink-0 items-center'>
          <button
            type='button'
            aria-label={_('Previous Month')}
            onClick={() => changeMonth(-1)}
            className='btn btn-ghost btn-circle size-11 min-h-11 p-0 disabled:bg-transparent'
          >
            <MdChevronLeft className='size-5 rtl:rotate-180' />
          </button>
          <button
            type='button'
            aria-label={_('Next Month')}
            disabled={month >= today.slice(0, 7)}
            onClick={() => changeMonth(1)}
            className='btn btn-ghost btn-circle size-11 min-h-11 p-0 disabled:bg-transparent'
          >
            <MdChevronRight className='size-5 rtl:rotate-180' />
          </button>
          <button
            type='button'
            className='btn btn-ghost min-h-11 px-3 text-sm'
            onClick={() => selectDate(today)}
          >
            {_('Today')}
          </button>
        </div>
      </div>
      <div
        ref={gridRef}
        className='relative overflow-clip p-1'
        onKeyDownCapture={handleKeyDown}
        aria-busy={loading}
        style={{ touchAction: 'pan-y pinch-zoom' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={cancelSwipe}
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) cancelSwipe(event);
        }}
        onClickCapture={(event) => {
          if (suppressSwipeClick.current && event.detail > 0) {
            event.preventDefault();
            event.stopPropagation();
            suppressSwipeClick.current = false;
          }
        }}
      >
        <div ref={monthGridRef} data-calendar-month={month}>
          <div
            aria-hidden='true'
            className='text-base-content/70 mb-2 grid grid-cols-7 text-center text-xs'
          >
            {Array.from({ length: 7 }, (_, index) => (
              <span key={index}>
                {new Date(2026, 10, 2 + index).toLocaleDateString(locale, { weekday: 'narrow' })}
              </span>
            ))}
          </div>
          <div className='grid grid-cols-7 gap-1'>
            {days.map((day, index) => {
              if (!day) return <span key={`pad-${index}`} />;
              const key = toDateKey(day);
              const books = readings.get(key) ?? [];
              const seconds = books.reduce((sum, book) => sum + book.seconds, 0);
              return (
                <button
                  key={key}
                  type='button'
                  data-calendar-date={key}
                  aria-label={`${formatDay(key)} · ${time(seconds)}${books.length ? ` · ${books.map((book) => book.title).join(', ')}` : ''}`}
                  aria-pressed={selected === key}
                  aria-current={key === today ? 'date' : undefined}
                  tabIndex={selected === key ? 0 : -1}
                  disabled={key > today}
                  onClick={() => selectDate(key)}
                  className={clsx(
                    'eink-bordered focus-visible:outline-base-content flex min-h-20 min-w-0 flex-col gap-1 rounded-sm border p-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40',
                    selected === key
                      ? 'border-base-content bg-base-200 outline-base-content outline outline-1'
                      : 'border-base-200 hover:bg-base-200',
                  )}
                >
                  <span
                    className={clsx(
                      'self-center tabular-nums',
                      key === today && 'font-bold underline',
                    )}
                  >
                    {day.toLocaleDateString(locale, { day: 'numeric' })}
                  </span>
                  <span aria-hidden='true' className='relative block aspect-[2/3] w-full'>
                    {books.slice(0, 3).map((reading, bookIndex) => (
                      <span
                        key={reading.bookMd5}
                        className='absolute inset-y-0 block'
                        style={{
                          insetInlineStart: books.length === 1 ? 0 : `${bookIndex * 17}%`,
                          width: books.length === 1 ? '100%' : '66%',
                        }}
                      >
                        <BookCover
                          book={coverBook(reading)}
                          isPreview
                          imageClassName='shadow-none!'
                        />
                      </span>
                    ))}
                    {books.length > 3 && (
                      <span className='eink-bordered bg-base-100 absolute bottom-0 end-0 rounded-sm border px-0.5 text-[10px]'>
                        +{(books.length - 3).toLocaleString(locale)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className='border-base-200 min-w-0 border-t pt-3'>
        <h3 className='text-sm font-medium'>{formatDay(selected)}</h3>
        {failed ? (
          <div className='flex flex-wrap items-center gap-2 py-2 text-sm'>
            <p>{_('Failed to load reading statistics')}</p>
            <button
              type='button'
              className='btn btn-ghost min-h-11'
              onClick={() => setRetry(retry + 1)}
            >
              {_('Try Again')}
            </button>
          </div>
        ) : (
          <>
            <p role='status' className='text-base-content/70 mt-1 text-sm'>
              {loading
                ? _('Loading')
                : selectedBooks.length
                  ? time(selectedBooks.reduce((sum, book) => sum + book.seconds, 0))
                  : _('No reading activity on this day')}
            </p>
            {!loading && selectedBooks.length > 0 && (
              <ul className='mt-3 flex flex-col gap-3'>
                {selectedBooks.map((reading) => (
                  <li key={reading.bookMd5} className='flex min-w-0 items-center gap-3'>
                    <div aria-hidden='true' className='h-16 w-11 shrink-0'>
                      <BookCover
                        book={coverBook(reading)}
                        isPreview
                        imageClassName='shadow-none!'
                      />
                    </div>
                    <div className='min-w-0 flex-1'>
                      <p dir='auto' className='line-clamp-2 break-words text-sm font-medium'>
                        {reading.title}
                      </p>
                      <p dir='auto' className='text-base-content/70 truncate text-xs'>
                        {reading.authors}
                      </p>
                    </div>
                    <span className='shrink-0 text-sm tabular-nums'>{time(reading.seconds)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ReadingCalendar;
