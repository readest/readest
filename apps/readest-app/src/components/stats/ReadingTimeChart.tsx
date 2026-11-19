import clsx from 'clsx';
import React, { useRef, useState } from 'react';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import SegmentedControl from '@/components/SegmentedControl';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getReadingBars,
  shiftPeriod,
  toDateKey,
  type ReadingRange,
} from '@/services/statistics/readingStats';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';

interface ReadingTimeChartProps {
  daily: Map<string, number>;
}

const ReadingTimeChart: React.FC<ReadingTimeChartProps> = ({ daily }) => {
  const _ = useTranslation();
  const [range, setRange] = useState<ReadingRange>('week');
  const [period, setPeriod] = useState(() => new Date());
  const [selected, setSelected] = useState<number | null>(null);
  const pointerFocus = useRef(false);

  const locale = getLocale();
  const today = new Date();
  const todayKey = toDateKey(today);
  // A reading dated after today (from a device whose clock runs ahead) doesn't count yet.
  const pastDaily = new Map([...daily].filter(([key]) => key <= todayKey));
  const bars = getReadingBars(pastDaily, range, period);
  const start = bars[0]!.date;
  const end = shiftPeriod(range, start, 1);
  const isCurrent = end > today;
  const firstKey = [...pastDaily.keys(), todayKey].sort()[0]!;
  // Days not yet come can't be selected, and the average leaves them out.
  const lastIndex = bars.filter((bar) => bar.date <= today).length - 1;
  const daysEnd = isCurrent
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    : end;
  const days = Math.round((daysEnd.getTime() - start.getTime()) / 86400000);
  const total = bars.reduce((sum, bar) => sum + bar.seconds, 0);
  const max = Math.max(...bars.map((bar) => bar.seconds), 60);
  const time = (seconds: number) => formatDuration(Math.floor(seconds / 60), _);

  const periodLabel =
    range === 'year'
      ? String(start.getFullYear())
      : range === 'month'
        ? start.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
        : new Intl.DateTimeFormat(locale, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }).formatRange(start, bars[bars.length - 1]!.date);
  const [previousLabel, nextLabel] = {
    week: [_('Previous Week'), _('Next Week')],
    month: [_('Previous Month'), _('Next Month')],
    year: [_('Previous Year'), _('Next Year')],
  }[range];

  const changePeriod = (delta: number) => {
    setPeriod(shiftPeriod(range, start, delta));
    setSelected(null);
  };

  const formatBarDate = (date: Date) =>
    range === 'year'
      ? date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      : date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });

  const formatAxisLabel = (date: Date, index: number) => {
    if (range === 'week') return date.toLocaleDateString(locale, { weekday: 'narrow' });
    if (range === 'year') return date.toLocaleDateString(locale, { month: 'narrow' });
    return index % 7 === 0 ? String(date.getDate()) : '';
  };

  const bar = selected !== null ? bars[selected] : undefined;

  // One tab stop for the chart, like the heatmap: arrows step through the bars
  // and the caption above announces the selected one.
  // Bound in the capture phase: Dialog stops every keydown at its own node,
  // so a bubbling React handler inside it never runs.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[event.key];
    if (!step || selected === null) return;
    event.preventDefault();
    setSelected(Math.min(lastIndex, Math.max(0, selected + step)));
  };

  // Hover only brightens the bar under the pointer (with a tooltip); the
  // headline changes on a deliberate click, tap or arrow key, never in passing.
  const handleClick = (event: React.MouseEvent) => {
    pointerFocus.current = false;
    const index = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')?.dataset[
      'index'
    ];
    if (index !== undefined) setSelected(selected === Number(index) ? null : Number(index));
  };

  const handleFocus = () => {
    if (!pointerFocus.current) setSelected((current) => current ?? lastIndex);
    pointerFocus.current = false;
  };

  return (
    <div className='flex flex-col gap-4'>
      <SegmentedControl<ReadingRange>
        fullWidth
        ariaLabel={_('Time Range')}
        options={[
          { value: 'week', label: _('Week') },
          { value: 'month', label: _('Month') },
          { value: 'year', label: _('Year') },
        ]}
        value={range}
        onChange={(value) => {
          setRange(value);
          setPeriod(new Date());
          setSelected(null);
        }}
      />
      <div className='flex items-center justify-between'>
        <span className='font-medium tabular-nums'>{periodLabel}</span>
        <div className='flex items-center gap-1'>
          <button
            type='button'
            aria-label={previousLabel}
            disabled={toDateKey(start) <= firstKey}
            onClick={() => changePeriod(-1)}
            className='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0 disabled:bg-transparent'
          >
            <MdChevronLeft className='h-5 w-5 rtl:rotate-180' />
          </button>
          <button
            type='button'
            aria-label={nextLabel}
            disabled={isCurrent}
            onClick={() => changePeriod(1)}
            className='btn btn-ghost btn-circle h-8 min-h-8 w-8 p-0 disabled:bg-transparent'
          >
            <MdChevronRight className='h-5 w-5 rtl:rotate-180' />
          </button>
        </div>
      </div>
      <div role='status'>
        <div className='text-2xl font-semibold tabular-nums'>{time(bar ? bar.seconds : total)}</div>
        <div className='text-base-content/70 text-[0.85em]'>
          {bar
            ? formatBarDate(bar.date)
            : _('Daily average {{time}}', { time: time(total / days) })}
        </div>
      </div>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        role='group'
        tabIndex={0}
        aria-label={_('Reading Time')}
        className='focus-visible:ring-base-content/15 rounded-sm focus-visible:outline-hidden focus-visible:ring-2'
        onPointerDown={() => (pointerFocus.current = true)}
        onClick={handleClick}
        onFocus={handleFocus}
        onBlur={() => setSelected(null)}
        onKeyDownCapture={handleKeyDown}
      >
        <div
          aria-hidden='true'
          className='border-base-300 flex h-32 items-end gap-0.5 border-b sm:gap-1'
        >
          {bars.map((item, index) => (
            <span
              key={item.date.getTime()}
              data-index={index <= lastIndex ? index : undefined}
              title={
                index <= lastIndex
                  ? `${formatBarDate(item.date)} · ${time(item.seconds)}`
                  : undefined
              }
              className={clsx(
                'group flex h-full min-w-0 flex-1 items-end',
                index <= lastIndex && 'cursor-pointer',
              )}
            >
              <span
                className={clsx(
                  'mx-auto w-full max-w-10 rounded-t-sm transition-colors duration-150',
                  selected === index
                    ? 'bg-base-content'
                    : 'bg-base-content/55 group-hover:bg-base-content/80',
                )}
                style={{
                  height: item.seconds > 0 ? `${Math.max(2, (item.seconds / max) * 100)}%` : 0,
                }}
              />
            </span>
          ))}
        </div>
        <div
          aria-hidden='true'
          className='text-base-content/70 mt-1 flex gap-0.5 text-[0.75em] sm:gap-1'
        >
          {bars.map((item, index) => (
            <span
              key={item.date.getTime()}
              className='min-w-0 flex-1 whitespace-nowrap text-center tabular-nums'
            >
              {formatAxisLabel(item.date, index)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ReadingTimeChart;
