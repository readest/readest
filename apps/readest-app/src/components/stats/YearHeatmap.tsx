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

/**
 * A phone-first yearly overview: twelve months are easier to compare than a
 * 365-cell contribution grid, while day-level detail remains in Month view.
 */
const YearHeatmap: React.FC<YearHeatmapProps> = ({ daily, year }) => {
  const _ = useTranslation();
  const months = useMemo(() => {
    const totals = Array.from({ length: 12 }, () => 0);
    for (const row of daily) {
      const date = dayjs(row.dayStartTs * 1000);
      if (date.year() === year) totals[date.month()] += row.seconds;
    }
    return totals;
  }, [daily, year]);

  const maxSeconds = Math.max(60, ...months);
  const currentMonth = year === dayjs().year() ? dayjs().month() : 11;

  return (
    <div role='img' aria-label={_('Yearly reading time')}>
      <div className='grid h-36 grid-cols-12 items-end gap-2 px-1'>
        {months.map((seconds, month) => {
          const pct = seconds > 0 ? Math.max(7, Math.round((seconds / maxSeconds) * 100)) : 0;
          const future = month > currentMonth;
          return (
            <div
              key={month}
              className='flex h-full items-end justify-center'
              title={`${year}-${String(month + 1).padStart(2, '0')} · ${formatReadingDuration(seconds, _)}`}
            >
              {pct > 0 ? (
                <div
                  className='bg-primary/85 w-4 max-w-full rounded-full'
                  style={{ height: `${pct}%`, minHeight: '8px' }}
                />
              ) : (
                <div
                  className={clsx(
                    'h-1 w-4 max-w-full rounded-full',
                    future ? 'bg-base-content/5' : 'bg-base-content/12',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className='text-neutral-content/60 mt-2 grid grid-cols-12 gap-2 px-1 text-center text-[9px] tabular-nums'>
        {months.map((_, month) => (
          <span key={month}>{month + 1}</span>
        ))}
      </div>
    </div>
  );
};

export default YearHeatmap;
