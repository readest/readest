'use client';

import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { DailyReadingSummary } from '@/types/statistics';
import { getLocalDateString } from '@/utils/format';

interface TrendChartProps {
  dailySummaries: Record<string, DailyReadingSummary>;
  dateRange: 'week' | 'month' | 'year';
  onDateRangeChange?: (range: 'week' | 'month' | 'year') => void;
}

interface DataPoint {
  date: string;
  label: string;
  value: number;
}

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const getDateRangeData = (
  dailySummaries: Record<string, DailyReadingSummary>,
  range: 'week' | 'month' | 'year',
): DataPoint[] => {
  const data: DataPoint[] = [];
  const today = new Date();

  if (range === 'week') {
    // Daily view: Last 7 days, one point per day
    for (let i = 6; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = getLocalDateString(date);
      const summary = dailySummaries[dateStr];

      data.push({
        date: dateStr,
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
        value: summary?.totalDuration || 0,
      });
    }
  } else if (range === 'month') {
    // Weekly view: Last 5 weeks, one point per week
    for (let i = 4; i >= 0; i--) {
      const weekEnd = new Date(today);
      weekEnd.setDate(weekEnd.getDate() - i * 7);
      const weekStart = new Date(weekEnd);
      weekStart.setDate(weekStart.getDate() - 6);

      let totalDuration = 0;
      for (let j = 0; j < 7; j++) {
        const date = new Date(weekStart);
        date.setDate(date.getDate() + j);
        const dateStr = getLocalDateString(date);
        const summary = dailySummaries[dateStr];
        totalDuration += summary?.totalDuration || 0;
      }

      data.push({
        date: getLocalDateString(weekStart),
        label: `${weekStart.getMonth() + 1}/${weekStart.getDate()}`,
        value: totalDuration,
      });
    }
  } else {
    // Monthly view: Last 12 months, one point per month
    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthEnd = new Date(today.getFullYear(), today.getMonth() - i + 1, 0);

      let totalDuration = 0;
      const currentDate = new Date(monthDate);
      while (currentDate <= monthEnd) {
        const dateStr = getLocalDateString(currentDate);
        const summary = dailySummaries[dateStr];
        totalDuration += summary?.totalDuration || 0;
        currentDate.setDate(currentDate.getDate() + 1);
      }

      data.push({
        date: getLocalDateString(monthDate),
        label: monthDate.toLocaleDateString('en-US', { month: 'short' }),
        value: totalDuration,
      });
    }
  }

  return data;
};

const TrendChart: React.FC<TrendChartProps> = ({
  dailySummaries,
  dateRange,
  onDateRangeChange,
}) => {
  const _ = useTranslation();
  const [hoveredPoint, setHoveredPoint] = useState<DataPoint | null>(null);

  const data = useMemo(
    () => getDateRangeData(dailySummaries, dateRange),
    [dailySummaries, dateRange],
  );

  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const chartHeight = 120;
  const chartWidth = 280;
  const padding = { top: 10, right: 10, bottom: 30, left: 10 };

  const points = data.map((d, i) => ({
    ...d,
    x: padding.left + (i / (data.length - 1 || 1)) * (chartWidth - padding.left - padding.right),
    y: padding.top + (1 - d.value / maxValue) * (chartHeight - padding.top - padding.bottom),
  }));

  // Create smooth path using cardinal spline interpolation
  const createPath = () => {
    if (points.length < 2) return '';
    const firstPoint = points[0];
    if (!firstPoint) return '';

    let path = `M ${firstPoint.x} ${firstPoint.y}`;

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(points.length - 1, i + 2)]!;

      const tension = 0.3;
      const cp1x = p1.x + ((p2.x - p0.x) * tension) / 3;
      const cp1y = p1.y + ((p2.y - p0.y) * tension) / 3;
      const cp2x = p2.x - ((p3.x - p1.x) * tension) / 3;
      const cp2y = p2.y - ((p3.y - p1.y) * tension) / 3;

      path += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`;
    }

    return path;
  };

  // Create area fill path
  const createAreaPath = () => {
    const linePath = createPath();
    if (!linePath) return '';

    const lastPoint = points[points.length - 1]!;
    const firstPoint = points[0]!;
    const bottom = chartHeight - padding.bottom;

    return `${linePath} L ${lastPoint.x} ${bottom} L ${firstPoint.x} ${bottom} Z`;
  };

  const totalDuration = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className='bg-base-200 rounded-xl p-4'>
      <div className='mb-4 flex items-center justify-between'>
        <div>
          <h3 className='text-base-content font-semibold'>{_('Reading Trend')}</h3>
          <p className='text-base-content/60 text-sm'>
            {_('Total: {{duration}}', { duration: formatDuration(totalDuration) })}
          </p>
        </div>
        <div className='flex gap-1'>
          {(['week', 'month', 'year'] as const).map((range) => (
            <button
              key={range}
              className={clsx('btn btn-xs', dateRange === range ? 'btn-primary' : 'btn-ghost')}
              onClick={() => onDateRangeChange?.(range)}
            >
              {range === 'week' ? _('Daily') : range === 'month' ? _('Weekly') : _('Monthly')}
            </button>
          ))}
        </div>
      </div>

      <div className='relative'>
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className='w-full'
          style={{ maxHeight: `${chartHeight}px` }}
        >
          {/* Grid lines */}
          <g className='text-base-content/10'>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = padding.top + (1 - ratio) * (chartHeight - padding.top - padding.bottom);
              return (
                <line
                  key={ratio}
                  x1={padding.left}
                  y1={y}
                  x2={chartWidth - padding.right}
                  y2={y}
                  stroke='currentColor'
                  strokeWidth={0.5}
                  strokeDasharray={ratio > 0 && ratio < 1 ? '2,2' : undefined}
                />
              );
            })}
          </g>

          {/* Area fill */}
          <path d={createAreaPath()} className='fill-primary/20' />

          {/* Line */}
          <path
            d={createPath()}
            fill='none'
            className='stroke-primary'
            strokeWidth={2}
            strokeLinecap='round'
            strokeLinejoin='round'
          />

          {/* Data points */}
          {points.map((point, i) => (
            <g key={i}>
              <circle
                cx={point.x}
                cy={point.y}
                r={hoveredPoint?.date === point.date ? 5 : 3}
                className={clsx(
                  'transition-all',
                  hoveredPoint?.date === point.date
                    ? 'fill-primary'
                    : 'fill-base-100 stroke-primary',
                )}
                strokeWidth={2}
                onMouseEnter={() => setHoveredPoint(point)}
                onMouseLeave={() => setHoveredPoint(null)}
                style={{ cursor: 'pointer' }}
              />
            </g>
          ))}

          {/* X-axis labels */}
          <g className='text-base-content/60'>
            {points.map((point, i) => (
              <text
                key={i}
                x={point.x}
                y={chartHeight - 5}
                textAnchor='middle'
                fontSize={10}
                fill='currentColor'
              >
                {point.label}
              </text>
            ))}
          </g>
        </svg>

        {/* Tooltip */}
        {hoveredPoint && (
          <div
            className='bg-base-300 text-base-content pointer-events-none absolute rounded px-2 py-1 text-xs shadow-lg'
            style={{
              left: `${((points.find((p) => p.date === hoveredPoint.date)?.x || 0) / chartWidth) * 100}%`,
              top: `${(points.find((p) => p.date === hoveredPoint.date)?.y || 0) - 30}px`,
              transform: 'translateX(-50%)',
            }}
          >
            <div className='font-medium'>{formatDuration(hoveredPoint.value)}</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TrendChart;
