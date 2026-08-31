'use client';

import React, { useMemo } from 'react';
import dayjs from 'dayjs';
import { useTranslation } from '@/hooks/useTranslation';
import type { DailyReadTime } from '@/types/statistics';
import { formatReadingDuration } from '@/utils/stats';

interface DailyBarChartProps {
  daily: DailyReadTime[];
  fromTs: number;
  toTs: number;
  /** Week view labels every bar with a weekday letter; month view marks ~weekly ticks. */
  variant: 'week' | 'month';
}

/**
 * Hand-rolled daily reading-time bar chart (WeChat-Reading style): one bar per
 * local day between fromTs and toTs, height proportional to the busiest day.
 * A 60s floor keeps empty days visible as stubs instead of collapsing.
 */
const DailyBarChart: React.FC<DailyBarChartProps> = ({ daily, fromTs, toTs, variant }) => {
  const _ = useTranslation();

  const days = useMemo(() => {
    const secondsByDay = new Map(daily.map((d) => [d.dayStartTs * 1000, d.seconds]));
    const out: { dayStartTs: number; seconds: number }[] = [];
    let cursor = dayjs(fromTs).startOf('day');
    const end = dayjs(toTs).startOf('day');
    while (cursor.isBefore(end)) {
      const ts = cursor.valueOf();
      out.push({ dayStartTs: ts, seconds: secondsByDay.get(ts) ?? 0 });
      cursor = cursor.add(1, 'day');
    }
    return out;
  }, [daily, fromTs, toTs]);

  const maxSeconds = Math.max(60, ...days.map((d) => d.seconds));

  const showLabel = (dayStartTs: number) => {
    if (variant === 'week') return true;
    const day = dayjs(dayStartTs);
    return day.date() === 1 || day.day() === 1; // the 1st and every Monday
  };

  return (
    <div>
      <div
        className='flex h-28 items-end gap-x-[2px]'
        role='img'
        aria-label={_('Daily reading time')}
      >
        {days.map(({ dayStartTs, seconds }) => {
          const pct = seconds > 0 ? Math.max(6, Math.round((seconds / maxSeconds) * 100)) : 0;
          return (
            <div
              key={dayStartTs}
              className='flex h-full min-w-0 flex-1 flex-col justify-end'
              title={`${dayjs(dayStartTs).format('YYYY-MM-DD')} · ${formatReadingDuration(seconds, _)}`}
            >
              {pct > 0 ? (
                <div
                  className='bg-primary/85 w-full rounded-t-[3px]'
                  style={{ height: `${pct}%` }}
                />
              ) : (
                <div className='bg-base-content/15 h-[3px] w-full rounded-t-[2px]' />
              )}
            </div>
          );
        })}
      </div>
      <div className='text-neutral-content/70 mt-1 flex gap-x-[2px] text-[10px] leading-none'>
        {days.map(({ dayStartTs }) => (
          <span key={dayStartTs} className='min-w-0 flex-1 overflow-visible text-center'>
            {showLabel(dayStartTs) ? dayjs(dayStartTs).format(variant === 'week' ? 'dd' : 'D') : ''}
          </span>
        ))}
      </div>
    </div>
  );
};

export default DailyBarChart;
