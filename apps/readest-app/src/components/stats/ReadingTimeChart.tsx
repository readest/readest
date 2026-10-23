import clsx from 'clsx';
import React, { useRef, useState } from 'react';
import SegmentedControl from '@/components/SegmentedControl';
import { useTranslation } from '@/hooks/useTranslation';
import { getReadingBars, type ReadingRange } from '@/services/statistics/readingStats';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';

interface ReadingTimeChartProps {
  daily: Map<string, number>;
}

const ReadingTimeChart: React.FC<ReadingTimeChartProps> = ({ daily }) => {
  const _ = useTranslation();
  const [range, setRange] = useState<ReadingRange>('week');
  const [selected, setSelected] = useState<number | null>(null);
  const pointerFocus = useRef(false);

  const locale = getLocale();
  const bars = getReadingBars(daily, range);
  const total = bars.reduce((sum, bar) => sum + bar.seconds, 0);
  const max = Math.max(...bars.map((bar) => bar.seconds), 60);
  const today = new Date();
  const days = Math.round((today.getTime() - bars[0]!.date.getTime()) / 86400000) + 1;
  const time = (seconds: number) => formatDuration(Math.floor(seconds / 60), _);

  const formatBarDate = (date: Date) =>
    range === 'year'
      ? date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      : date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });

  const formatAxisLabel = (date: Date, index: number) => {
    if (range === 'week') return date.toLocaleDateString(locale, { weekday: 'narrow' });
    if (range === 'year') return date.toLocaleDateString(locale, { month: 'narrow' });
    // Label every 7th day counting back from today, so today is always labeled.
    return (bars.length - 1 - index) % 7 === 0 ? String(date.getDate()) : '';
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
    setSelected(Math.min(bars.length - 1, Math.max(0, selected + step)));
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
    if (!pointerFocus.current) setSelected((current) => current ?? bars.length - 1);
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
          setSelected(null);
        }}
      />
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
              data-index={index}
              title={`${formatBarDate(item.date)} · ${time(item.seconds)}`}
              className='group flex h-full min-w-0 flex-1 cursor-pointer items-end'
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
