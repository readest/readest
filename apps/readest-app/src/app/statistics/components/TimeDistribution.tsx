'use client';

import { useState } from 'react';
import clsx from 'clsx';
import { useTranslation } from '@/hooks/useTranslation';
import { UserStatistics } from '@/types/statistics';

interface TimeDistributionProps {
  stats: UserStatistics;
}

type ViewMode = 'hour' | 'day';

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const formatHour = (hour: number): string => {
  if (hour === 0) return '12am';
  if (hour === 12) return '12pm';
  if (hour < 12) return `${hour}am`;
  return `${hour - 12}pm`;
};

const TimeDistribution: React.FC<TimeDistributionProps> = ({ stats }) => {
  const _ = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('hour');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const data = viewMode === 'hour' ? stats.readingByHour : stats.readingByDayOfWeek;
  const labels = viewMode === 'hour' ? HOURS.map(formatHour) : DAYS;
  const maxValue = Math.max(...data, 1);

  // Find peak time
  const peakIndex = data.indexOf(Math.max(...data));
  const peakLabel = labels[peakIndex];
  const peakValue = data[peakIndex] || 0;

  return (
    <div className='bg-base-200 rounded-xl p-4'>
      <div className='mb-4 flex items-center justify-between'>
        <div>
          <h3 className='text-base-content font-semibold'>{_('Reading Time')}</h3>
          {peakValue > 0 && (
            <p className='text-base-content/60 text-sm'>
              {_('Peak: {{time}}', { time: peakLabel })}
            </p>
          )}
        </div>
        <div className='flex gap-1'>
          <button
            className={clsx('btn btn-xs', viewMode === 'hour' ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setViewMode('hour')}
          >
            {_('By Hour')}
          </button>
          <button
            className={clsx('btn btn-xs', viewMode === 'day' ? 'btn-primary' : 'btn-ghost')}
            onClick={() => setViewMode('day')}
          >
            {_('By Day')}
          </button>
        </div>
      </div>

      <div className='relative'>
        {/* Bar chart */}
        <div className={clsx('flex items-end gap-[2px]', viewMode === 'hour' ? 'h-24' : 'h-32')}>
          {data.map((value, index) => {
            const height = (value / maxValue) * 100;
            const isHovered = hoveredIndex === index;
            const isPeak = index === peakIndex && value > 0;

            return (
              <div
                key={index}
                className='relative flex flex-1 flex-col items-center'
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Bar */}
                <div
                  className={clsx(
                    'w-full rounded-t transition-all duration-200',
                    isPeak ? 'bg-primary' : 'bg-primary/60',
                    isHovered && 'brightness-110',
                    value === 0 && 'bg-base-300',
                  )}
                  style={{
                    height: `${Math.max(height, value > 0 ? 4 : 2)}%`,
                    minHeight: value > 0 ? '4px' : '2px',
                  }}
                />

                {/* Tooltip */}
                {isHovered && (
                  <div
                    className='bg-base-300 text-base-content pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded px-2 py-1 text-xs shadow-lg'
                    style={{ transform: 'translateX(0)' }}
                  >
                    <div className='font-medium'>{labels[index]}</div>
                    <div className='text-base-content/70'>{formatDuration(value)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* X-axis labels */}
        <div
          className={clsx('mt-2 flex', viewMode === 'hour' ? 'justify-between' : 'justify-around')}
        >
          {viewMode === 'hour' ? (
            // Show every 6 hours for hourly view
            <>
              <span className='text-base-content/50 text-xs'>12am</span>
              <span className='text-base-content/50 text-xs'>6am</span>
              <span className='text-base-content/50 text-xs'>12pm</span>
              <span className='text-base-content/50 text-xs'>6pm</span>
              <span className='text-base-content/50 text-xs'>12am</span>
            </>
          ) : (
            // Show all days for weekly view
            DAYS.map((day, i) => (
              <span
                key={day}
                className={clsx(
                  'text-xs',
                  i === peakIndex && data[i]! > 0
                    ? 'text-primary font-medium'
                    : 'text-base-content/50',
                )}
              >
                {day}
              </span>
            ))
          )}
        </div>
      </div>

      {/* Summary */}
      {viewMode === 'day' && (
        <div className='mt-4 grid grid-cols-2 gap-2 text-center'>
          <div className='bg-base-300/50 rounded-lg p-2'>
            <div className='text-base-content/60 text-xs'>{_('Weekdays')}</div>
            <div className='text-base-content text-sm font-semibold'>
              {formatDuration(data.slice(1, 6).reduce((a, b) => a + b, 0))}
            </div>
          </div>
          <div className='bg-base-300/50 rounded-lg p-2'>
            <div className='text-base-content/60 text-xs'>{_('Weekends')}</div>
            <div className='text-base-content text-sm font-semibold'>
              {formatDuration((data[0] || 0) + (data[6] || 0))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TimeDistribution;
