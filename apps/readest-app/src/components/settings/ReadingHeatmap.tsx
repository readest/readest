import clsx from 'clsx';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { formatReadingTime } from '@/utils/formatReadingTime';
import type { DailyReading } from '@/services/statistics/readingStatsService';

interface ReadingHeatmapProps {
  /** Daily reading data for the heatmap range. */
  data: DailyReading[];
  /** Calendar year to display. Defaults to current year. */
  year?: number;
}

// ── Intensity levels (GitHub uses 5: 0 = none, 1–4 = quartiles) ────

type Level = 0 | 1 | 2 | 3 | 4;

const LEVEL_CLASSES: Record<Level, string> = {
  0: 'bg-base-200',
  1: 'bg-primary/20',
  2: 'bg-primary/40',
  3: 'bg-primary/65',
  4: 'bg-primary/90',
};

const DAY_LABELS = ['', 'M', '', 'W', '', 'F', ''] as const;

interface CellData {
  date: string;
  seconds: number;
  level: Level;
  dayOfWeek: number;
  isInHalf: boolean;
  isFuture: boolean;
}

interface MonthLabel {
  label: string;
  weekIndex: number;
}

interface HalfYearGrid {
  weeks: CellData[][];
  monthLabels: MonthLabel[];
}

// ── Component ────────────────────────────────────────────────────────

const ReadingHeatmap: React.FC<ReadingHeatmapProps> = ({ data, year: yearProp }) => {
  const _ = useTranslation();
  const year = yearProp ?? new Date().getFullYear();

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    date: string;
    seconds: number;
  } | null>(null);

  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const update = () => {
      setIsMobile(window.innerWidth < 640);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const colWidth = isMobile ? 11 : 15;

  const monthNames = useMemo(
    () => [
      _('Jan'),
      _('Feb'),
      _('Mar'),
      _('Apr'),
      _('May'),
      _('Jun'),
      _('Jul'),
      _('Aug'),
      _('Sep'),
      _('Oct'),
      _('Nov'),
      _('Dec'),
    ],
    [_],
  );

  const { half1, half2 } = useMemo(() => {
    const readingMap = new Map<string, number>();
    for (const d of data) {
      readingMap.set(d.date, d.totalSeconds);
    }

    // Compute percentile thresholds from non-zero days for dynamic levels.
    const nonZero = data.filter((d) => d.totalSeconds > 0).map((d) => d.totalSeconds);
    nonZero.sort((a, b) => a - b);
    const pct = (p: number) =>
      nonZero.length > 0
        ? (nonZero[Math.floor(p * nonZero.length)] ?? nonZero[nonZero.length - 1]!)
        : 1;

    const t = {
      q1: pct(0.25),
      q2: pct(0.5),
      q3: pct(0.75),
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const buildHalf = (startMonth: number, endMonth: number): HalfYearGrid => {
      const startDate = new Date(year, startMonth, 1);
      const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      const daysInEndMonth = endMonth === 5 ? 30 : endMonth === 1 ? (isLeapYear ? 29 : 28) : 31;
      const endDate = new Date(year, endMonth, daysInEndMonth);

      // Align first week to Sunday.
      const startAligned = new Date(startDate);
      startAligned.setDate(startAligned.getDate() - startAligned.getDay());

      // Align last week to Saturday.
      const endAligned = new Date(endDate);
      endAligned.setDate(endAligned.getDate() + (6 - endAligned.getDay()));

      const totalDays =
        Math.round((endAligned.getTime() - startAligned.getTime()) / (24 * 60 * 60 * 1000)) + 1;
      const numWeeks = Math.ceil(totalDays / 7);

      const weeks: CellData[][] = [];
      const monthLabels: MonthLabel[] = [];
      let lastMonthAdded = -1;

      for (let w = 0; w < numWeeks; w++) {
        const week: CellData[] = [];
        for (let d = 0; d < 7; d++) {
          const cellDate = new Date(startAligned);
          cellDate.setDate(startAligned.getDate() + w * 7 + d);

          const isInHalf =
            cellDate.getFullYear() === year &&
            cellDate.getMonth() >= startMonth &&
            cellDate.getMonth() <= endMonth;
          const isFuture = cellDate > today;

          const iso = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
          const seconds = readingMap.get(iso) ?? 0;

          let level: Level = 0;
          if (isInHalf && !isFuture && seconds > 0) {
            if (seconds >= t.q3) level = 4;
            else if (seconds >= t.q2) level = 3;
            else if (seconds >= t.q1) level = 2;
            else level = 1;
          }

          week.push({
            date: iso,
            seconds,
            level,
            dayOfWeek: d,
            isInHalf,
            isFuture,
          });

          // Check for month label placement.
          if (isInHalf) {
            const m = cellDate.getMonth();
            if (m !== lastMonthAdded) {
              monthLabels.push({ label: monthNames[m]!, weekIndex: w });
              lastMonthAdded = m;
            }
          }
        }
        weeks.push(week);
      }

      return { weeks, monthLabels };
    };

    return {
      half1: buildHalf(0, 5), // Jan - Jun
      half2: buildHalf(6, 11), // Jul - Dec
    };
  }, [data, year, monthNames]);

  const handleCellInteraction = (
    e: React.MouseEvent | React.TouchEvent,
    date: string,
    seconds: number,
  ) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setTooltip({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
      date,
      seconds,
    });
  };

  const handleDismissTooltip = () => setTooltip(null);

  const formatDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const renderHalfGrid = (half: HalfYearGrid, ariaTitle: string) => {
    return (
      <div className='w-full overflow-x-auto scrollbar-none'>
        {/* Month labels */}
        <div
          className='flex text-[0.65em] sm:text-[0.7em] text-base-content/50 mb-1'
          style={{ paddingInlineStart: isMobile ? '20px' : '24px' }}
        >
          {half.monthLabels.map((m, i) => (
            <span
              key={`${m.label}-${i}`}
              className='shrink-0'
              style={{
                width:
                  i < half.monthLabels.length - 1
                    ? `${((half.monthLabels[i + 1]?.weekIndex ?? half.weeks.length) - m.weekIndex) * colWidth}px`
                    : 'auto',
              }}
            >
              {m.label}
            </span>
          ))}
        </div>

        <div className='flex gap-[2px]' aria-label={ariaTitle}>
          {/* Day-of-week labels */}
          <div className='flex flex-col gap-[2px] pe-0.5 text-[0.6em] sm:text-[0.65em] text-base-content/50'>
            {DAY_LABELS.map((label, i) => (
              <div
                key={i}
                className='flex h-[9px] w-[18px] sm:h-[13px] sm:w-[22px] items-center justify-end'
              >
                {label}
              </div>
            ))}
          </div>

          {/* Grid of cells */}
          <div className='flex gap-[2px]'>
            {half.weeks.map((week, wi) => (
              <div key={wi} className='flex flex-col gap-[2px]'>
                {week.map((cell) => {
                  if (!cell.isInHalf) {
                    return (
                      <div
                        key={cell.date}
                        className='h-[9px] w-[9px] sm:h-[13px] sm:w-[13px] invisible'
                        aria-hidden='true'
                      />
                    );
                  }

                  if (cell.isFuture) {
                    return (
                      <div
                        key={cell.date}
                        className='h-[9px] w-[9px] sm:h-[13px] sm:w-[13px] rounded-[2px] bg-base-200/40 opacity-40'
                        aria-hidden='true'
                      />
                    );
                  }

                  return (
                    <div
                      key={cell.date}
                      className={clsx(
                        'h-[9px] w-[9px] sm:h-[13px] sm:w-[13px] rounded-[2px] cursor-pointer transition-colors duration-150',
                        LEVEL_CLASSES[cell.level],
                      )}
                      onMouseEnter={(e) => handleCellInteraction(e, cell.date, cell.seconds)}
                      onTouchStart={(e) => handleCellInteraction(e, cell.date, cell.seconds)}
                      aria-label={`${formatDate(cell.date)}: ${formatReadingTime(cell.seconds)}`}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className='relative w-full'
      onMouseLeave={handleDismissTooltip}
      role='img'
      aria-label={_('Reading activity heatmap')}
    >
      <div className='flex flex-col gap-3 sm:gap-4'>
        {/* Top: January to June */}
        {renderHalfGrid(half1, _('January to June'))}

        {/* Next: July to December */}
        {renderHalfGrid(half2, _('July to December'))}
      </div>

      {/* Legend */}
      <div className='mt-2.5 flex items-center justify-end gap-1 text-[0.65em] text-base-content/50'>
        <span>{_('Less')}</span>
        {([0, 1, 2, 3, 4] as Level[]).map((level) => (
          <div
            key={level}
            className={clsx(
              'h-[9px] w-[9px] sm:h-[11px] sm:w-[11px] rounded-[2px]',
              LEVEL_CLASSES[level],
            )}
          />
        ))}
        <span>{_('More')}</span>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <div
          className={clsx(
            'bg-base-content text-base-100 pointer-events-none fixed z-50',
            'rounded-md px-2 py-1 text-xs font-medium shadow-lg',
          )}
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div>{formatDate(tooltip.date)}</div>
          <div className='text-base-100/80'>
            {tooltip.seconds > 0
              ? _('{{time}} of reading', { time: formatReadingTime(tooltip.seconds) })
              : _('No reading')}
          </div>
        </div>
      )}
    </div>
  );
};

export default ReadingHeatmap;
