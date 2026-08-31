'use client';

import React, { useMemo } from 'react';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import type { DailyReadTime } from '@/types/statistics';
import { formatReadingDuration } from '@/utils/stats';

interface YearHeatmapProps {
  daily: DailyReadTime[];
  year: number;
}

const LEVEL_CLASSES = [
  'bg-base-content/10',
  'bg-primary/25',
  'bg-primary/45',
  'bg-primary/70',
  'bg-primary/95',
] as const;

/**
 * GitHub-style calendar heatmap for one year (WeChat Reading's year tab):
 * Monday-start week columns, 5 color levels scaled to the busiest day.
 * Columns flex so the whole year fits the dialog width without scrolling.
 */
const YearHeatmap: React.FC<YearHeatmapProps> = ({ daily, year }) => {
  const _ = useTranslation();

  const { weeks, monthLabels } = useMemo(() => {
    const secondsByDay = new Map(daily.map((d) => [d.dayStartTs * 1000, d.seconds]));
    // Monday-start alignment: leading blanks before day 1, then chunk by 7.
    const start = dayjs().year(year).startOf('year');
    const isCurrentYear = year === dayjs().year();
    const end = isCurrentYear ? dayjs().startOf('day') : start.endOf('year').startOf('day');
    const lead = (start.day() + 6) % 7;

    type Cell = { dayStartTs: number; seconds: number; date: dayjs.Dayjs } | null;
    const cells: Cell[] = Array.from({ length: lead }, () => null);
    for (let d = start; !d.isAfter(end); d = d.add(1, 'day')) {
      const ts = d.startOf('day').valueOf();
      cells.push({ dayStartTs: ts, seconds: secondsByDay.get(ts) ?? 0, date: d });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const chunked: Cell[][] = [];
    for (let i = 0; i < cells.length; i += 7) chunked.push(cells.slice(i, i + 7));

    // A month label sits on the first week column that contains that month's 1st.
    const labels: (string | null)[] = chunked.map(() => null);
    let lastMonth = -1;
    chunked.forEach((week, col) => {
      for (const cell of week) {
        if (!cell) continue;
        if (cell.date.date() <= 7 && cell.date.month() !== lastMonth) {
          lastMonth = cell.date.month();
          labels[col] = cell.date.format('MMM');
        }
        break;
      }
    });
    return { weeks: chunked, monthLabels: labels };
  }, [daily, year]);

  const maxSeconds = Math.max(60, ...daily.map((d) => d.seconds));
  const levelOf = (seconds: number) =>
    seconds <= 0 ? 0 : 1 + Math.min(3, Math.floor((seconds / maxSeconds) * 4));

  return (
    <div className='w-full'>
      <div className='flex'>
        {monthLabels.map((label, col) => (
          <div key={col} className='text-neutral-content/70 min-w-0 flex-1 text-[9px] leading-none'>
            {label ? <span className='inline-block max-w-full truncate'>{label}</span> : ''}
          </div>
        ))}
      </div>
      <div className='mt-1 flex gap-x-[3px]' role='img' aria-label={_('Yearly reading time')}>
        {weeks.map((week, col) => (
          <div key={col} className='flex min-w-0 flex-1 flex-col gap-y-[3px]'>
            {week.map((cell, row) => (
              <div
                key={row}
                className={clsx(
                  'aspect-square w-full rounded-[2px]',
                  cell ? LEVEL_CLASSES[levelOf(cell.seconds)] : 'bg-transparent',
                )}
                title={
                  cell
                    ? `${cell.date.format('YYYY-MM-DD')} · ${formatReadingDuration(cell.seconds, _)}`
                    : ''
                }
              />
            ))}
          </div>
        ))}
      </div>
      <div className='text-neutral-content/70 mt-2 flex items-center justify-end gap-1 text-[10px]'>
        <span>{_('Less')}</span>
        {LEVEL_CLASSES.map((cls) => (
          <span key={cls} className={clsx('h-[9px] w-[9px] rounded-[2px]', cls)} />
        ))}
        <span>{_('More')}</span>
      </div>
    </div>
  );
};

export default YearHeatmap;
