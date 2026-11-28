import clsx from 'clsx';
import React, { useState } from 'react';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import SegmentedControl from '@/components/SegmentedControl';
import { useTranslation } from '@/hooks/useTranslation';
import {
  getSpeedChange,
  getSpeedPoints,
  sumSpeeds,
  toPace,
} from '@/services/statistics/readingSpeedStats';
import { shiftPeriod, toDateKey, type ReadingRange } from '@/services/statistics/readingStats';
import type { ReadingSpeed, ReadingSpeedUnit } from '@/types/statistics';
import { formatDuration } from '@/utils/duration';
import { getLocale } from '@/utils/misc';
import { formatPace, formatUnit } from './formatReadingSpeed';

/** Gridlines at round values around the paces shown, at most five. */
const getScale = (paces: number[]) => {
  const low = Math.min(...paces);
  const high = Math.max(...paces);
  const rough = Math.max((high - low) / 3, high / 20, 1);
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * power).find((s) => s >= rough)!;
  let min = Math.floor(low / step) * step;
  let max = Math.ceil(high / step) * step;
  if (min === max) {
    min = Math.max(0, min - step);
    max += step;
  }
  const ticks: number[] = [];
  for (let tick = max; tick >= min; tick -= step) ticks.push(tick);
  return { min, max, ticks };
};

interface ReadingSpeedChartProps {
  daily: Map<string, ReadingSpeed>;
  unit: ReadingSpeedUnit;
}

const ReadingSpeedChart: React.FC<ReadingSpeedChartProps> = ({ daily, unit }) => {
  const _ = useTranslation();
  const [range, setRange] = useState<ReadingRange>('month');
  const [period, setPeriod] = useState(() => new Date());
  const [selected, setSelected] = useState<number | null>(null);

  const locale = getLocale();
  const today = new Date();
  const todayKey = toDateKey(today);
  const pastDaily = new Map([...daily].filter(([key]) => key <= todayKey));
  const points = getSpeedPoints(pastDaily, range, period);
  const start = points[0]!.date;
  const end = shiftPeriod(range, start, 1);
  const isCurrent = end > today;
  const firstKey = [...pastDaily.keys(), todayKey].sort()[0]!;
  const total = sumSpeeds(pastDaily, start, end);
  const change = getSpeedChange(total, sumSpeeds(pastDaily, shiftPeriod(range, start, -1), start));
  const measured = points.flatMap(({ speed }, index) => (speed ? [index] : []));
  const shown = selected ?? measured[measured.length - 1] ?? null;
  const point = shown !== null ? points[shown] : undefined;
  const paces = points.map(({ speed }) => toPace(speed));
  const scale = measured.length ? getScale(measured.map((i) => paces[i]!)) : null;
  const pace = (value: number | null) =>
    value === null ? '—' : formatPace(value, unit, locale, _);
  const unitLabel = formatUnit(unit, _);
  const average = toPace(total);

  const periodLabel =
    range === 'year'
      ? String(start.getFullYear())
      : range === 'month'
        ? start.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
        : new Intl.DateTimeFormat(locale, {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          }).formatRange(start, points[points.length - 1]!.date);
  const [previousLabel, nextLabel] = {
    week: [_('Previous Week'), _('Next Week')],
    month: [_('Previous Month'), _('Next Month')],
    year: [_('Previous Year'), _('Next Year')],
  }[range];

  const formatPointDate = (date: Date) =>
    range === 'year'
      ? date.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
      : date.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });

  const formatAxisLabel = (date: Date, index: number) => {
    if (range === 'week') return date.toLocaleDateString(locale, { weekday: 'narrow' });
    if (range === 'year') return date.toLocaleDateString(locale, { month: 'narrow' });
    return index % 7 === 0 ? String(date.getDate()) : '';
  };

  const changePeriod = (delta: number) => {
    setPeriod(shiftPeriod(range, start, delta));
    setSelected(null);
  };

  const x = (index: number) => ((index + 0.5) / points.length) * 100;
  const y = (value: number) =>
    scale ? (1 - (value - scale.min) / (scale.max - scale.min)) * 100 : 0;
  const line = measured.map((i) => `${x(i)},${y(paces[i]!)}`).join(' ');
  const area =
    measured.length > 1
      ? `${x(measured[0]!)},100 ${line} ${x(measured[measured.length - 1]!)},100`
      : '';

  // One tab stop for the chart, like the reading time chart: arrows step
  // through the measured points and the card below announces the selected one.
  // Bound in the capture phase: Dialog stops every keydown at its own node.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = { ArrowLeft: rtl ? 1 : -1, ArrowRight: rtl ? -1 : 1 }[event.key];
    if (!step || shown === null) return;
    event.preventDefault();
    const position = measured.indexOf(shown) + step;
    if (position >= 0 && position < measured.length) setSelected(measured[position]!);
  };

  const handleClick = (event: React.MouseEvent) => {
    const index = (event.target as HTMLElement).closest<HTMLElement>('[data-index]')?.dataset[
      'index'
    ];
    if (index !== undefined) setSelected(Number(index));
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
      <div className='eink-bordered border-base-200 grid grid-cols-2 rounded-lg border'>
        <div className='flex flex-col justify-between gap-1 p-3'>
          <span className='text-base-content/70 text-[0.85em]'>{_('Average Speed')}</span>
          {/* The number set large and its unit beside it, so it fits a phone's half width. */}
          <span className='flex flex-wrap items-baseline gap-x-1'>
            <span className='text-2xl font-semibold tabular-nums'>
              {average === null ? '—' : Math.round(average).toLocaleString(locale)}
            </span>{' '}
            {average !== null && (
              <span className='text-base-content/70 text-[0.85em]'>{unitLabel}</span>
            )}
          </span>
        </div>
        <div className='border-base-200 flex flex-col justify-between gap-1 border-s p-3'>
          <span className='text-base-content/70 text-[0.85em]'>
            {_('Change from Previous Period')}
          </span>
          <span className='text-2xl font-semibold tabular-nums'>
            {change === null
              ? '—'
              : change.toLocaleString(locale, {
                  style: 'percent',
                  maximumFractionDigits: 1,
                  signDisplay: 'exceptZero',
                })}
          </span>
        </div>
      </div>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        role='group'
        tabIndex={measured.length ? 0 : -1}
        aria-label={_('Reading Speed')}
        className='focus-visible:ring-base-content/15 grid grid-cols-[auto_1fr] gap-x-2 rounded-sm focus-visible:outline-hidden focus-visible:ring-2'
        onClick={handleClick}
        onKeyDownCapture={handleKeyDown}
      >
        <span aria-hidden='true' className='text-base-content/70 col-span-2 mb-2 text-[0.75em]'>
          {unitLabel}
        </span>
        <div
          aria-hidden='true'
          className='text-base-content/70 relative h-36 min-w-6 text-end text-[0.75em] tabular-nums'
        >
          {scale?.ticks.map((tick) => (
            <span
              key={tick}
              className='absolute end-0 -translate-y-1/2 whitespace-nowrap'
              style={{ top: `${y(tick)}%` }}
            >
              {tick.toLocaleString(locale)}
            </span>
          ))}
        </div>
        <div className='border-base-300 relative h-36 border-b'>
          {scale?.ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden='true'
              className='border-base-200 absolute inset-x-0 border-t'
              style={{ top: `${y(tick)}%` }}
            />
          ))}
          {!measured.length && (
            <span className='text-base-content/70 absolute inset-0 flex items-center justify-center text-center text-[0.85em]'>
              {_('No reading speed measured')}
            </span>
          )}
          {/* Drawn left to right, then mirrored for RTL like the columns around it. */}
          <div aria-hidden='true' className='absolute inset-0 rtl:-scale-x-100'>
            <svg
              viewBox='0 0 100 100'
              preserveAspectRatio='none'
              className='absolute inset-0 h-full w-full overflow-visible'
            >
              {area && <polygon points={area} className='fill-base-content/10 eink:hidden' />}
              {measured.length > 1 && (
                <polyline
                  points={line}
                  fill='none'
                  strokeWidth={2}
                  strokeLinejoin='round'
                  vectorEffect='non-scaling-stroke'
                  className='stroke-base-content/80'
                />
              )}
            </svg>
            {measured.map((index) => (
              <span
                key={index}
                className={clsx(
                  'border-base-content absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                  index === shown ? 'bg-base-content h-3 w-3' : 'bg-base-100 h-2 w-2',
                )}
                style={{ left: `${x(index)}%`, top: `${y(paces[index]!)}%` }}
              />
            ))}
          </div>
          <div aria-hidden='true' className='absolute inset-0 flex'>
            {points.map((item, index) => (
              <span
                key={item.date.getTime()}
                data-index={item.speed ? index : undefined}
                title={
                  item.speed ? `${formatPointDate(item.date)} · ${pace(paces[index]!)}` : undefined
                }
                className={clsx('h-full min-w-0 flex-1', item.speed && 'cursor-pointer')}
              />
            ))}
          </div>
        </div>
        <span />
        <div aria-hidden='true' className='text-base-content/70 mt-1 flex text-[0.75em]'>
          {points.map((item, index) => (
            <span
              key={item.date.getTime()}
              className='min-w-0 flex-1 whitespace-nowrap text-center tabular-nums'
            >
              {formatAxisLabel(item.date, index)}
            </span>
          ))}
        </div>
      </div>
      {point?.speed && (
        <div
          role='status'
          className='eink-bordered border-base-200 flex flex-col gap-1 rounded-lg border p-3'
        >
          <span className='font-medium'>{formatPointDate(point.date)}</span>
          <div className='flex flex-wrap justify-between gap-x-3'>
            <span className='text-base-content/70'>{_('Average Speed')}</span>
            <span className='tabular-nums'>{pace(paces[shown!]!)}</span>
          </div>
          <div className='flex flex-wrap justify-between gap-x-3'>
            <span className='text-base-content/70'>{_('Measured Reading Time')}</span>
            <span className='tabular-nums'>
              {formatDuration(Math.max(1, Math.round(point.speed.durationMs / 60_000)), _)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

export default ReadingSpeedChart;
