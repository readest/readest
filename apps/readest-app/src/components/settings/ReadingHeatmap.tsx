import clsx from 'clsx';
import React, { useMemo, useState } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { formatReadingTime } from '@/utils/formatReadingTime';
import type { DailyReading } from '@/services/statistics/readingStatsService';

interface ReadingHeatmapProps {
  /** Daily reading data for the heatmap range. */
  data: DailyReading[];
  /** Number of weeks to display. @default 26 on narrow, 52 on wide */
  weeks?: number;
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

// ── Component ────────────────────────────────────────────────────────

const ReadingHeatmap: React.FC<ReadingHeatmapProps> = ({ data, weeks: weeksProp }) => {
  const _ = useTranslation();
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    date: string;
    seconds: number;
  } | null>(null);

  // Determine week count based on viewport width if not provided.
  const weeks = weeksProp ?? (typeof window !== 'undefined' && window.innerWidth < 640 ? 20 : 52);

  const { grid, monthLabels } = useMemo(() => {
    // Build a lookup from date string → total seconds.
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

    // Build the grid: weeks × 7 days. End date = today (column-last, row = day-of-week).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const totalDays = weeks * 7;

    // Find the start date: go back (totalDays - 1) days, then align to the
    // nearest previous Sunday (column start).
    const start = new Date(today);
    start.setDate(start.getDate() - (totalDays - 1));
    // Align to Sunday (day 0).
    const startDow = start.getDay();
    start.setDate(start.getDate() - startDow);

    // Recount from aligned start to today.
    const alignedTotalDays =
      Math.floor((today.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    const alignedWeeks = Math.ceil(alignedTotalDays / 7);

    const gridData: {
      date: string;
      seconds: number;
      level: Level;
      dayOfWeek: number;
      weekIndex: number;
      isInRange: boolean;
    }[][] = [];

    const months: { label: string; weekIndex: number }[] = [];
    const monthNames = [
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
    ];
    let lastMonth = -1;

    for (let w = 0; w < alignedWeeks; w++) {
      const week: (typeof gridData)[number] = [];
      for (let d = 0; d < 7; d++) {
        const cellDate = new Date(start);
        cellDate.setDate(start.getDate() + w * 7 + d);

        const iso = `${cellDate.getFullYear()}-${String(cellDate.getMonth() + 1).padStart(2, '0')}-${String(cellDate.getDate()).padStart(2, '0')}`;
        const seconds = readingMap.get(iso) ?? 0;
        const isInRange = cellDate <= today;

        // Determine level.
        let level: Level = 0;
        if (seconds > 0 && isInRange) {
          if (seconds >= t.q3) level = 4;
          else if (seconds >= t.q2) level = 3;
          else if (seconds >= t.q1) level = 2;
          else level = 1;
        }

        week.push({ date: iso, seconds, level, dayOfWeek: d, weekIndex: w, isInRange });

        // Track month labels (first cell of each new month).
        const month = cellDate.getMonth();
        if (d === 0 && month !== lastMonth && isInRange) {
          months.push({ label: monthNames[month]!, weekIndex: w });
          lastMonth = month;
        }
      }
      gridData.push(week);
    }

    return { grid: gridData, monthLabels: months };
  }, [data, weeks, _]);

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
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div
      className='relative w-full'
      onMouseLeave={handleDismissTooltip}
      role='img'
      aria-label={_('Reading activity heatmap')}
    >
      {/* Month labels */}
      <div
        className='flex text-[0.7em] text-base-content/50 mb-1'
        style={{ paddingInlineStart: '28px' }}
      >
        {monthLabels.map((m, i) => (
          <span
            key={`${m.label}-${i}`}
            className='shrink-0'
            style={{
              // Position each month label at its week column.
              // Cell size ≈ 13px + 2px gap = 15px per column.
              width:
                i < monthLabels.length - 1
                  ? `${((monthLabels[i + 1]?.weekIndex ?? grid.length) - m.weekIndex) * 15}px`
                  : 'auto',
            }}
          >
            {m.label}
          </span>
        ))}
      </div>

      <div className='flex gap-0.5'>
        {/* Day-of-week labels */}
        <div className='flex flex-col gap-0.5 pe-1 text-[0.65em] text-base-content/50'>
          {DAY_LABELS.map((label, i) => (
            <div key={i} className='flex h-[13px] w-[20px] items-center justify-end'>
              {label}
            </div>
          ))}
        </div>

        {/* Grid of cells */}
        <div className='flex gap-0.5 overflow-hidden'>
          {grid.map((week, wi) => (
            <div key={wi} className='flex flex-col gap-0.5'>
              {week.map((cell) => (
                <div
                  key={cell.date}
                  className={clsx(
                    'h-[13px] w-[13px] rounded-[2px] transition-colors duration-150',
                    cell.isInRange ? LEVEL_CLASSES[cell.level] : 'bg-transparent',
                    cell.isInRange && 'cursor-pointer',
                  )}
                  onMouseEnter={(e) =>
                    cell.isInRange && handleCellInteraction(e, cell.date, cell.seconds)
                  }
                  onTouchStart={(e) =>
                    cell.isInRange && handleCellInteraction(e, cell.date, cell.seconds)
                  }
                  aria-label={
                    cell.isInRange
                      ? `${formatDate(cell.date)}: ${formatReadingTime(cell.seconds)}`
                      : undefined
                  }
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className='mt-2 flex items-center justify-end gap-1 text-[0.65em] text-base-content/50'>
        <span>{_('Less')}</span>
        {([0, 1, 2, 3, 4] as Level[]).map((level) => (
          <div
            key={level}
            className={clsx('h-[11px] w-[11px] rounded-[2px]', LEVEL_CLASSES[level])}
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
