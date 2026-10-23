import clsx from 'clsx';
import React, { useRef, useState } from 'react';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import { useTranslation } from '@/hooks/useTranslation';
import { toDateKey } from '@/services/statistics/readingStats';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';

// Half a year spans at most 28 Sunday-first weeks; both halves use the same
// column count so their cells line up.
const WEEKS = 28;
const LEVEL_CLASSES = [
  'bg-base-200',
  'bg-base-content/20',
  'bg-base-content/40',
  'bg-base-content/65',
  'bg-base-content',
];

interface ReadingHeatmapProps {
  daily: Map<string, number>;
}

const getHalfYear = (year: number, startMonth: number) => {
  const first = new Date(year, startMonth, 1);
  const days: (Date | null)[] = Array.from({ length: first.getDay() }, () => null);
  for (let d = first; d.getMonth() < startMonth + 6 && d.getFullYear() === year; ) {
    days.push(d);
    d = new Date(year, d.getMonth(), d.getDate() + 1);
  }
  return days;
};

const ReadingHeatmap: React.FC<ReadingHeatmapProps> = ({ daily }) => {
  const _ = useTranslation();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [selected, setSelected] = useState<string | null>(null);
  const pointerFocus = useRef(false);

  const locale = getLocale();
  const todayKey = toDateKey(new Date());
  const firstYear = Math.min(
    currentYear,
    ...[...daily.keys()].map((key) => Number(key.slice(0, 4))),
  );
  const yearDays = [...daily].filter(([key, seconds]) => key.startsWith(`${year}-`) && seconds > 0);
  const yearTotal = yearDays.reduce((sum, [, seconds]) => sum + seconds, 0);
  const sorted = yearDays.map(([, seconds]) => seconds).sort((a, b) => a - b);
  const quartiles = [0.25, 0.5, 0.75].map((q) => sorted[Math.floor(q * sorted.length)] ?? 0);
  const time = (seconds: number) => formatDuration(Math.floor(seconds / 60), _);

  const getLevel = (seconds: number) =>
    seconds <= 0 ? 0 : 1 + quartiles.filter((threshold) => seconds >= threshold).length;

  const formatDay = (key: string) =>
    new Date(`${key}T00:00:00`).toLocaleDateString(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });

  // Hover only outlines the day under the pointer (with a tooltip); the status
  // line changes on a deliberate click, tap or arrow key, never in passing.
  const handleClick = (event: React.MouseEvent) => {
    pointerFocus.current = false;
    const date = (event.target as HTMLElement).dataset['date'];
    if (date) setSelected(selected === date ? null : date);
  };

  // One tab stop for the whole year: arrows step a day down a column or a
  // week across columns, and the status line below announces the day.
  // Bound in the capture phase: Dialog stops every keydown at its own node,
  // so a bubbling React handler inside it never runs.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const steps: Record<string, number> = {
      ArrowUp: -1,
      ArrowDown: 1,
      ArrowLeft: rtl ? 7 : -7,
      ArrowRight: rtl ? -7 : 7,
    };
    const step = steps[event.key];
    if (!step || !selected) return;
    event.preventDefault();
    const date = new Date(`${selected}T00:00:00`);
    date.setDate(date.getDate() + step);
    if (date.getFullYear() === year) setSelected(toDateKey(date));
  };

  const handleFocus = () => {
    if (!pointerFocus.current && !selected) {
      setSelected(year === currentYear ? todayKey : `${year}-01-01`);
    }
    pointerFocus.current = false;
  };

  const changeYear = (delta: number) => {
    setYear(year + delta);
    setSelected(null);
  };

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between'>
        <span className='font-medium tabular-nums'>{year}</span>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            aria-label={_('Previous Year')}
            disabled={year <= firstYear}
            onClick={() => changeYear(-1)}
            className='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0 disabled:bg-transparent'
          >
            <MdChevronLeft className='h-5 w-5 rtl:rotate-180' />
          </button>
          <button
            type='button'
            aria-label={_('Next Year')}
            disabled={year >= currentYear}
            onClick={() => changeYear(1)}
            className='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0 disabled:bg-transparent'
          >
            <MdChevronRight className='h-5 w-5 rtl:rotate-180' />
          </button>
        </div>
      </div>

      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        role='group'
        tabIndex={0}
        aria-label={_('Reading activity')}
        className='focus-visible:ring-base-content/15 flex flex-col gap-3 rounded-sm focus-visible:outline-hidden focus-visible:ring-2'
        onPointerDown={() => (pointerFocus.current = true)}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={() => setSelected(null)}
        onKeyDownCapture={handleKeyDown}
      >
        {[0, 6].map((startMonth) => {
          const days = getHalfYear(year, startMonth);
          const columns = { gridTemplateColumns: `repeat(${WEEKS}, minmax(0, 1fr))` };
          return (
            <div key={startMonth} className='flex flex-col gap-1'>
              <div className='text-base-content/70 grid text-[0.75em]' style={columns}>
                {days.map((day, index) =>
                  day?.getDate() === 1 ? (
                    <span
                      key={day.getMonth()}
                      className='col-span-4 whitespace-nowrap'
                      style={{ gridColumnStart: Math.floor(index / 7) + 1 }}
                    >
                      {day.toLocaleDateString(locale, { month: 'short' })}
                    </span>
                  ) : null,
                )}
              </div>
              <div
                aria-hidden='true'
                className='grid grid-flow-col grid-rows-7 gap-[3px]'
                style={columns}
              >
                {days.map((day, index) => {
                  if (!day) return <span key={`pad-${index}`} />;
                  const key = toDateKey(day);
                  return (
                    <span
                      key={key}
                      data-date={key}
                      title={`${formatDay(key)} · ${time(daily.get(key) ?? 0)}`}
                      className={clsx(
                        'aspect-square cursor-pointer rounded-[2px] outline-offset-1',
                        LEVEL_CLASSES[getLevel(daily.get(key) ?? 0)],
                        key > todayKey && 'opacity-40',
                        selected === key
                          ? 'outline-base-content outline outline-1'
                          : 'hover:outline-base-content/40 hover:outline hover:outline-1',
                      )}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className='text-base-content/70 flex items-center justify-between gap-2 text-[0.85em]'>
        <span role='status' className='truncate tabular-nums'>
          {selected
            ? `${formatDay(selected)} · ${time(daily.get(selected) ?? 0)}`
            : _('{{time}} in {{year}}', { time: time(yearTotal), year })}
        </span>
        <div className='flex shrink-0 items-center gap-1 text-[0.85em]'>
          <span>{_('Less')}</span>
          {LEVEL_CLASSES.map((level) => (
            <span key={level} className={clsx('h-2.5 w-2.5 rounded-[2px]', level)} />
          ))}
          <span>{_('More')}</span>
        </div>
      </div>
    </div>
  );
};

export default ReadingHeatmap;
