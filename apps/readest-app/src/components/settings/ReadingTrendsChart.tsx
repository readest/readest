import React, { useMemo, useState, useRef } from 'react';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { formatReadingTime } from '@/utils/formatReadingTime';
import type { DailyReading } from '@/services/statistics/readingStatsService';

export type TimeRange = '7D' | '1M' | '3M' | '6M' | '1Y';

interface ReadingTrendsChartProps {
  data: DailyReading[];
  onRangeChange?: (range: TimeRange) => void;
}

interface DataPoint {
  date: string;
  label: string;
  seconds: number;
  bookCount: number;
  pages: number;
}

export const ReadingTrendsChart: React.FC<ReadingTrendsChartProps> = ({ data }) => {
  const _ = useTranslation();
  const [range, setRange] = useState<TimeRange>('3M');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Filter and aggregate data based on selected range
  const chartPoints = useMemo(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    let daysBack = 90;
    if (range === '7D') daysBack = 7;
    else if (range === '1M') daysBack = 30;
    else if (range === '3M') daysBack = 90;
    else if (range === '6M') daysBack = 180;
    else if (range === '1Y') daysBack = 365;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (daysBack - 1));
    startDate.setHours(0, 0, 0, 0);

    // Map of existing daily data
    const readingMap = new Map<string, DailyReading>();
    for (const d of data) {
      readingMap.set(d.date, d);
    }

    const points: DataPoint[] = [];

    if (range === '7D' || range === '1M') {
      // Daily granularity
      for (let i = 0; i < daysBack; i++) {
        const d = new Date(startDate);
        d.setDate(startDate.getDate() + i);
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const item = readingMap.get(iso);
        const sec = item?.totalSeconds ?? 0;
        const bCount = item?.bookCount ?? (sec > 0 ? 1 : 0);
        // Estimate ~2 mins per page if page stats not per-day
        const pages = Math.round(sec / 120);

        points.push({
          date: iso,
          label: d.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
          }),
          seconds: sec,
          bookCount: bCount,
          pages,
        });
      }
    } else {
      // Weekly aggregation for 3M, 6M, 1Y
      // Ceiling division ensures we cover daysBack exactly without overrunning.
      const numWeeks = Math.ceil(daysBack / 7);
      // Anchor: the last bucket ends today; work backwards from today.
      const anchor = new Date();
      anchor.setHours(23, 59, 59, 999);

      for (let w = numWeeks - 1; w >= 0; w--) {
        const bucketEnd = new Date(anchor);
        bucketEnd.setDate(anchor.getDate() - w * 7);
        const bucketStart = new Date(bucketEnd);
        bucketStart.setDate(bucketEnd.getDate() - 6);
        bucketStart.setHours(0, 0, 0, 0);

        let totalSec = 0;
        let maxBooks = 0;

        for (let d = 0; d < 7; d++) {
          const cur = new Date(bucketStart);
          cur.setDate(bucketStart.getDate() + d);
          const iso = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
          const item = readingMap.get(iso);
          if (item) {
            totalSec += item.totalSeconds;
            maxBooks = Math.max(maxBooks, item.bookCount);
          }
        }

        const startLabel = bucketStart.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
        const endLabel = bucketEnd.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });

        points.push({
          date: `${startLabel} - ${endLabel}`,
          label: bucketStart.toLocaleDateString(undefined, { month: 'short' }),
          seconds: totalSec,
          bookCount: maxBooks || (totalSec > 0 ? 1 : 0),
          pages: Math.round(totalSec / 120),
        });
      }
    }

    return points;
  }, [data, range]);

  // Overall totals for the active range or currently hovered point
  const activePoint = hoveredIndex !== null ? chartPoints[hoveredIndex] : null;

  const totalTimeSeconds = useMemo(
    () => chartPoints.reduce((acc, p) => acc + p.seconds, 0),
    [chartPoints],
  );
  const totalBooks = useMemo(
    () => Math.max(...chartPoints.map((p) => p.bookCount), 0),
    [chartPoints],
  );
  const totalPages = useMemo(() => chartPoints.reduce((acc, p) => acc + p.pages, 0), [chartPoints]);

  // SVG Coordinates calculation
  const width = 500;
  const height = 180;
  const padLeft = 20;
  const padRight = 55;
  const padTop = 15;
  const padBottom = 25;

  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const maxVal = Math.max(...chartPoints.map((p) => p.seconds), 60);

  const coords = useMemo(() => {
    if (chartPoints.length === 0) return [];
    return chartPoints.map((p, i) => {
      const x = padLeft + (i / Math.max(chartPoints.length - 1, 1)) * chartWidth;
      const y = padTop + chartHeight - (p.seconds / maxVal) * chartHeight;
      return { x, y, point: p };
    });
  }, [chartPoints, maxVal, chartWidth, chartHeight]);

  // Build SVG path
  const pathD = useMemo(() => {
    if (coords.length === 0) return '';
    return coords.reduce((acc, c, i) => {
      if (i === 0) return `M ${c.x} ${c.y}`;
      return `${acc} L ${c.x} ${c.y}`;
    }, '');
  }, [coords]);

  const areaD = useMemo(() => {
    if (coords.length === 0) return '';
    const firstX = coords[0]!.x;
    const lastX = coords[coords.length - 1]!.x;
    const bottomY = padTop + chartHeight;
    return `${pathD} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  }, [coords, pathD, chartHeight]);

  // X-axis month ticks
  const xTicks = useMemo(() => {
    if (coords.length === 0) return [];
    const ticks: { x: number; label: string }[] = [];
    let lastLabel = '';
    const step = Math.max(1, Math.floor(coords.length / 5));

    for (let i = 0; i < coords.length; i += step) {
      const c = coords[i]!;
      if (c.point.label !== lastLabel) {
        ticks.push({ x: c.x, label: c.point.label.toUpperCase() });
        lastLabel = c.point.label;
      }
    }
    return ticks;
  }, [coords]);

  // Mouse & Touch interaction
  const handleInteraction = (clientX: number) => {
    if (!svgRef.current || coords.length === 0) return;
    const rect = svgRef.current.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * width;

    // Find nearest point
    let closestIdx = 0;
    let minDist = Infinity;
    coords.forEach((c, idx) => {
      const dist = Math.abs(c.x - svgX);
      if (dist < minDist) {
        minDist = dist;
        closestIdx = idx;
      }
    });

    setHoveredIndex(closestIdx);
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    handleInteraction(e.clientX);
  };

  const handleTouchMove = (e: React.TouchEvent<SVGSVGElement>) => {
    if (e.touches[0]) {
      handleInteraction(e.touches[0].clientX);
    }
  };

  const currentHoverCoord = hoveredIndex !== null ? coords[hoveredIndex] : null;

  return (
    <div className='w-full'>
      {/* ── Time Range Pills ────────────────────────────────────────── */}
      <div className='flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-3'>
        {(['7D', '1M', '3M', '6M', '1Y'] as TimeRange[]).map((r) => (
          <button
            key={r}
            type='button'
            onClick={() => {
              setRange(r);
              setHoveredIndex(null);
            }}
            className={clsx(
              'px-3.5 py-1 text-xs font-semibold rounded-xl transition-all',
              range === r
                ? 'border-primary text-primary bg-primary/10 border'
                : 'text-base-content/60 hover:text-base-content hover:bg-base-200 border-base-200 border bg-transparent',
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {/* ── Metric Display Header (like Strava/Fitness screenshot) ──── */}
      <div className='pt-2 pb-4'>
        <div className='text-base-content/70 text-xs font-medium mb-1 min-h-[18px]'>
          {activePoint ? activePoint.date : _('Total for period')}
        </div>

        <div className='grid grid-cols-3 gap-2'>
          <div>
            <div className='text-base-content/60 text-[0.7em] uppercase font-semibold tracking-wider'>
              {_('Time')}
            </div>
            <div className='text-base-content text-lg sm:text-xl font-bold tabular-nums'>
              {formatReadingTime(activePoint ? activePoint.seconds : totalTimeSeconds)}
            </div>
          </div>
          <div>
            <div className='text-base-content/60 text-[0.7em] uppercase font-semibold tracking-wider'>
              {_('Books')}
            </div>
            <div className='text-base-content text-lg sm:text-xl font-bold tabular-nums'>
              {activePoint ? activePoint.bookCount : totalBooks}
            </div>
          </div>
          <div>
            <div className='text-base-content/60 text-[0.7em] uppercase font-semibold tracking-wider'>
              {_('Pages')}
            </div>
            <div className='text-base-content text-lg sm:text-xl font-bold tabular-nums'>
              {(activePoint ? activePoint.pages : totalPages).toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* ── Line Chart SVG ────────────────────────────────────────── */}
      <div className='relative w-full overflow-hidden select-none'>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${width} ${height}`}
          className='w-full h-auto cursor-crosshair'
          onMouseMove={handleMouseMove}
          onTouchMove={handleTouchMove}
          onMouseLeave={() => setHoveredIndex(null)}
          onTouchEnd={() => setHoveredIndex(null)}
        >
          <defs>
            <linearGradient id='readingAreaGrad' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor='var(--color-primary, #f97316)' stopOpacity='0.40' />
              <stop offset='100%' stopColor='var(--color-primary, #f97316)' stopOpacity='0.02' />
            </linearGradient>
          </defs>

          {/* Horizontal gridlines */}
          <line
            x1={padLeft}
            y1={padTop}
            x2={width - padRight}
            y2={padTop}
            stroke='currentColor'
            className='text-base-content/10'
            strokeWidth='1'
          />
          <line
            x1={padLeft}
            y1={padTop + chartHeight / 2}
            x2={width - padRight}
            y2={padTop + chartHeight / 2}
            stroke='currentColor'
            className='text-base-content/10'
            strokeWidth='1'
          />
          <line
            x1={padLeft}
            y1={padTop + chartHeight}
            x2={width - padRight}
            y2={padTop + chartHeight}
            stroke='currentColor'
            className='text-base-content/15'
            strokeWidth='1'
          />

          {/* Y-axis labels on the right side */}
          <text
            x={width - padRight + 6}
            y={padTop + 4}
            className='fill-base-content/50 text-[10px] tabular-nums'
          >
            {formatReadingTime(maxVal)}
          </text>
          <text
            x={width - padRight + 6}
            y={padTop + chartHeight / 2 + 4}
            className='fill-base-content/50 text-[10px] tabular-nums'
          >
            {formatReadingTime(Math.round(maxVal / 2))}
          </text>
          <text
            x={width - padRight + 6}
            y={padTop + chartHeight + 4}
            className='fill-base-content/50 text-[10px] tabular-nums'
          >
            0m
          </text>

          {/* Area fill */}
          {areaD && <path d={areaD} fill='url(#readingAreaGrad)' />}

          {/* Line stroke */}
          {pathD && (
            <path
              d={pathD}
              fill='none'
              stroke='var(--color-primary, #f97316)'
              strokeWidth='2.5'
              strokeLinecap='round'
              strokeLinejoin='round'
            />
          )}

          {/* Individual points */}
          {coords.map((c, i) => (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={hoveredIndex === i ? 5 : 3}
              fill='var(--color-base-100, #ffffff)'
              stroke='var(--color-primary, #f97316)'
              strokeWidth={hoveredIndex === i ? 3 : 2}
            />
          ))}

          {/* Hover crosshair vertical guide */}
          {currentHoverCoord && (
            <>
              <line
                x1={currentHoverCoord.x}
                y1={padTop}
                x2={currentHoverCoord.x}
                y2={padTop + chartHeight}
                stroke='var(--color-primary, #f97316)'
                strokeWidth='1.5'
                strokeDasharray='3 3'
              />
              {/* Highlight halo on hovered point */}
              <circle
                cx={currentHoverCoord.x}
                cy={currentHoverCoord.y}
                r='10'
                fill='var(--color-primary, #f97316)'
                fillOpacity='0.25'
              />
              <circle
                cx={currentHoverCoord.x}
                cy={currentHoverCoord.y}
                r='5'
                fill='var(--color-primary, #f97316)'
              />
            </>
          )}

          {/* X-axis labels */}
          {xTicks.map((tick, i) => (
            <text
              key={i}
              x={tick.x}
              y={height - 6}
              textAnchor='middle'
              className='fill-base-content/50 text-[10px] font-semibold'
            >
              {tick.label}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
};

export default ReadingTrendsChart;
