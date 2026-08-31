'use client';

import React, { useMemo } from 'react';
import dayjs from 'dayjs';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import type { DailyReadTime } from '@/types/statistics';
import { formatReadingDuration } from '@/utils/stats';

interface DailyBarChartProps {
  daily: DailyReadTime[];
  fromTs: number;
  toTs: number;
  variant: 'week' | 'month';
}

type DayCell = { dayStartTs: number; seconds: number; future: boolean };

const DailyBarChart: React.FC<DailyBarChartProps> = ({ daily, fromTs, toTs, variant }) => {
  const _ = useTranslation();
  const secondsByDay = useMemo(
    () => new Map(daily.map((d) => [d.dayStartTs * 1000, d.seconds])),
    [daily],
  );

  const weekDays = useMemo<DayCell[]>(() => {
    const start = dayjs(fromTs).startOf('day');
    const today = dayjs().startOf('day');
    return Array.from({ length: 7 }, (_, i) => {
      const date = start.add(i, 'day');
      const ts = date.valueOf();
      return { dayStartTs: ts, seconds: secondsByDay.get(ts) ?? 0, future: date.isAfter(today) };
    });
  }, [fromTs, secondsByDay]);

  const monthCells = useMemo<(DayCell | null)[]>(() => {
    const start = dayjs(fromTs).startOf('month');
    const end = start.endOf('month');
    const today = dayjs(Math.min(Date.now(), toTs - 1)).startOf('day');
    const mondayLead = (start.day() + 6) % 7;
    const cells: (DayCell | null)[] = Array.from({ length: mondayLead }, () => null);
    for (let date = start; !date.isAfter(end); date = date.add(1, 'day')) {
      const ts = date.valueOf();
      cells.push({ dayStartTs: ts, seconds: secondsByDay.get(ts) ?? 0, future: date.isAfter(today) });
    }
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [fromTs, secondsByDay, toTs]);

  const maxSeconds = Math.max(60, ...daily.map((d) => d.seconds));

  if (variant === 'month') {
    const weekdays = Array.from({ length: 7 }, (_, i) => dayjs().day((i + 1) % 7).format('dd'));
    return (
      <div className='px-1' role='img' aria-label={_('Daily reading time')}>
        <div className='text-neutral-content/55 mb-2 grid grid-cols-7 text-center text-[10px]'>
          {weekdays.map((label, i) => (
            <span key={`${label}-${i}`}>{label}</span>
          ))}
        </div>
        <div className='grid grid-cols-7 gap-x-2 gap-y-2'>
          {monthCells.map((cell, index) => {
            if (!cell) return <span key={`blank-${index}`} className='aspect-square' />;
            const ratio = cell.seconds > 0 ? cell.seconds / maxSeconds : 0;
            return (
              <div
                key={cell.dayStartTs}
                className='flex aspect-square items-center justify-center'
                title={`${dayjs(cell.dayStartTs).format('YYYY-MM-DD')} · ${formatReadingDuration(cell.seconds, _)}`}
              >
                <span
                  className={clsx(
                    'flex h-8 w-8 items-center justify-center rounded-lg text-[11px] tabular-nums transition-colors',
                    cell.future
                      ? 'text-base-content/20'
                      : cell.seconds <= 0
                        ? 'bg-base-content/5 text-neutral-content/55'
                        : ratio > 0.66
                          ? 'bg-primary text-primary-content font-semibold'
                          : ratio > 0.33
                            ? 'bg-primary/60 text-primary-content font-medium'
                            : 'bg-primary/25 text-base-content font-medium',
                  )}
                >
                  {dayjs(cell.dayStartTs).date()}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const maxWeekSeconds = Math.max(60, ...weekDays.map((d) => d.seconds));
  return (
    <div role='img' aria-label={_('Daily reading time')}>
      <div className='grid h-32 grid-cols-7 items-end gap-3 px-2'>
        {weekDays.map(({ dayStartTs, seconds, future }) => {
          const pct = seconds > 0 ? Math.max(8, Math.round((seconds / maxWeekSeconds) * 100)) : 0;
          return (
            <div
              key={dayStartTs}
              className='flex h-full min-w-0 items-end justify-center'
              title={`${dayjs(dayStartTs).format('YYYY-MM-DD')} · ${formatReadingDuration(seconds, _)}`}
            >
              <div className='flex h-full w-full items-end justify-center'>
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
            </div>
          );
        })}
      </div>
      <div className='text-neutral-content/65 mt-2 grid grid-cols-7 gap-3 px-2 text-center text-[10px] leading-none'>
        {weekDays.map(({ dayStartTs }) => (
          <span key={dayStartTs}>{dayjs(dayStartTs).format('dd')}</span>
        ))}
      </div>
    </div>
  );
};

export default DailyBarChart;
