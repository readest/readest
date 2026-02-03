'use client';

import clsx from 'clsx';
import { useState, useMemo } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { DailyReadingSummary } from '@/types/statistics';
import { getLocalDateString } from '@/utils/format';

interface ReadingCalendarProps {
  year: number;
  dailySummaries: Record<string, DailyReadingSummary>;
  onYearChange?: (year: number) => void;
}

interface DayCell {
  date: string;
  dayOfMonth: number;
  duration: number; // seconds
  isCurrentMonth: boolean;
  isToday: boolean;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Get color intensity based on reading duration (in seconds)
const getColorClass = (duration: number): string => {
  if (duration === 0) return 'bg-base-300';
  if (duration < 15 * 60) return 'bg-success/30'; // < 15 min
  if (duration < 30 * 60) return 'bg-success/50'; // < 30 min
  if (duration < 60 * 60) return 'bg-success/70'; // < 1 hour
  return 'bg-success'; // 1+ hour
};

const formatDuration = (seconds: number): string => {
  if (seconds === 0) return 'No reading';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

// Parse YYYY-MM-DD string as LOCAL date (not UTC)
// new Date('2026-02-03') parses as UTC, causing timezone issues
const parseDateString = (dateStr: string): Date => {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year!, month! - 1, day);
};

const generateCalendarData = (
  year: number,
  dailySummaries: Record<string, DailyReadingSummary>,
): DayCell[][] => {
  const weeks: DayCell[][] = [];
  const today = getLocalDateString();

  // Start from the first day of the year
  const startDate = new Date(year, 0, 1);
  // Adjust to start from the Sunday of that week
  const startDay = startDate.getDay();
  startDate.setDate(startDate.getDate() - startDay);

  // End at the last day of the year
  const endDate = new Date(year, 11, 31);
  // Adjust to end at the Saturday of that week
  const endDay = endDate.getDay();
  endDate.setDate(endDate.getDate() + (6 - endDay));

  let currentWeek: DayCell[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    const dateStr = getLocalDateString(currentDate);
    const summary = dailySummaries[dateStr];
    const isCurrentYear = currentDate.getFullYear() === year;

    currentWeek.push({
      date: dateStr,
      dayOfMonth: currentDate.getDate(),
      duration: summary?.totalDuration || 0,
      isCurrentMonth: isCurrentYear,
      isToday: dateStr === today,
    });

    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  if (currentWeek.length > 0) {
    weeks.push(currentWeek);
  }

  return weeks;
};

const getMonthLabels = (weeks: DayCell[][]): { label: string; index: number }[] => {
  const labels: { label: string; index: number }[] = [];
  let lastMonth = -1;

  weeks.forEach((week, weekIndex) => {
    // Find a day in the current year in this week
    const dayInYear = week.find((d) => d.isCurrentMonth);
    if (!dayInYear) return;

    const date = parseDateString(dayInYear.date);
    const month = date.getMonth();

    if (month !== lastMonth && dayInYear.dayOfMonth <= 7) {
      labels.push({ label: MONTHS[month]!, index: weekIndex });
      lastMonth = month;
    }
  });

  return labels;
};

const ReadingCalendar: React.FC<ReadingCalendarProps> = ({
  year,
  dailySummaries,
  onYearChange,
}) => {
  const _ = useTranslation();
  const [hoveredDay, setHoveredDay] = useState<DayCell | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const weeks = useMemo(() => generateCalendarData(year, dailySummaries), [year, dailySummaries]);
  const monthLabels = useMemo(() => getMonthLabels(weeks), [weeks]);

  const handleMouseEnter = (day: DayCell, event: React.MouseEvent) => {
    setHoveredDay(day);
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltipPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 8,
    });
  };

  const handleMouseLeave = () => {
    setHoveredDay(null);
  };

  const currentYear = new Date().getFullYear();
  const canGoForward = year < currentYear;
  const canGoBackward = year > currentYear - 5; // Allow going back 5 years

  return (
    <div className='bg-base-200 rounded-xl p-4'>
      <div className='mb-4 flex items-center justify-between'>
        <h3 className='text-base-content font-semibold'>{_('Reading Activity')}</h3>
        <div className='flex items-center gap-2'>
          <button
            className='btn btn-ghost btn-sm'
            onClick={() => onYearChange?.(year - 1)}
            disabled={!canGoBackward}
          >
            ←
          </button>
          <span className='text-base-content/70 min-w-[60px] text-center text-sm font-medium'>
            {year}
          </span>
          <button
            className='btn btn-ghost btn-sm'
            onClick={() => onYearChange?.(year + 1)}
            disabled={!canGoForward}
          >
            →
          </button>
        </div>
      </div>

      {/* Month labels */}
      <div className='mb-1 flex'>
        <div className='w-6' /> {/* Spacer for day labels */}
        <div className='relative flex-1'>
          {monthLabels.map(({ label, index }) => (
            <span
              key={`${label}-${index}`}
              className='text-base-content/50 absolute text-xs'
              style={{ left: `${(index / weeks.length) * 100}%` }}
            >
              {label}
            </span>
          ))}
        </div>
      </div>

      {/* Calendar grid */}
      <div className='flex'>
        {/* Day labels */}
        <div className='flex w-6 flex-col justify-around pr-1'>
          {DAYS.map((day, i) => (
            <span
              key={i}
              className={clsx(
                'text-base-content/50 text-center text-xs',
                i % 2 === 1 ? 'visible' : 'invisible',
              )}
            >
              {day}
            </span>
          ))}
        </div>

        {/* Weeks grid */}
        <div className='flex flex-1 gap-[2px] overflow-x-auto'>
          {weeks.map((week, weekIndex) => (
            <div key={weekIndex} className='flex flex-col gap-[2px]'>
              {week.map((day) => (
                <div
                  key={day.date}
                  className={clsx(
                    'h-3 w-3 rounded-sm transition-colors',
                    getColorClass(day.duration),
                    day.isToday && 'ring-primary ring-1 ring-offset-1',
                    !day.isCurrentMonth && 'opacity-30',
                    'hover:ring-base-content/30 cursor-pointer hover:ring-1',
                  )}
                  onMouseEnter={(e) => handleMouseEnter(day, e)}
                  onMouseLeave={handleMouseLeave}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className='mt-4 flex items-center justify-end gap-2'>
        <span className='text-base-content/50 text-xs'>{_('Less')}</span>
        <div className='bg-base-300 h-3 w-3 rounded-sm' />
        <div className='bg-success/30 h-3 w-3 rounded-sm' />
        <div className='bg-success/50 h-3 w-3 rounded-sm' />
        <div className='bg-success/70 h-3 w-3 rounded-sm' />
        <div className='bg-success h-3 w-3 rounded-sm' />
        <span className='text-base-content/50 text-xs'>{_('More')}</span>
      </div>

      {/* Tooltip */}
      {hoveredDay && (
        <div
          className='bg-base-300 text-base-content pointer-events-none fixed z-50 rounded px-2 py-1 text-xs shadow-lg'
          style={{
            left: tooltipPosition.x,
            top: tooltipPosition.y,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className='font-medium'>{hoveredDay.date}</div>
          <div className='text-base-content/70'>{formatDuration(hoveredDay.duration)}</div>
        </div>
      )}
    </div>
  );
};

export default ReadingCalendar;
