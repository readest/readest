import { useMemo } from 'react';
import clsx from 'clsx';
import { PiFlame } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';

interface StreakDisplayProps {
  currentStreak: number;
  longestStreak: number;
  lastReadDate: string;
}

// Use local timezone to match statisticsStore date format
const getDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const StreakDisplay: React.FC<StreakDisplayProps> = ({
  currentStreak,
  longestStreak,
  lastReadDate,
}) => {
  const _ = useTranslation();

  const { today, yesterday, last7Days } = useMemo(() => {
    const now = new Date();
    const yesterdayDate = new Date(now);
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);

    const days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date(now);
      date.setDate(date.getDate() - (6 - i));
      return getDateString(date);
    });

    return {
      today: getDateString(now),
      yesterday: getDateString(yesterdayDate),
      last7Days: days,
    };
  }, []);

  const isActiveToday = lastReadDate === today;
  const isActiveYesterday = lastReadDate === yesterday;
  const hasActiveStreak = currentStreak > 0;

  return (
    <div
      className={clsx(
        'bg-base-200 rounded-xl p-4',
        hasActiveStreak && 'border-2 border-orange-400/30',
      )}
    >
      <div className='flex items-center justify-between'>
        <div className='flex items-center gap-3'>
          <div
            className={clsx(
              'flex h-12 w-12 items-center justify-center rounded-full',
              hasActiveStreak ? 'bg-orange-400/20' : 'bg-base-300',
            )}
          >
            <PiFlame
              size={28}
              className={clsx(
                hasActiveStreak ? 'text-orange-400' : 'text-base-content/40',
                hasActiveStreak && 'animate-pulse',
              )}
            />
          </div>
          <div>
            <div className='text-base-content text-3xl font-bold'>{currentStreak}</div>
            <div className='text-base-content/60 text-sm'>
              {currentStreak === 1 ? _('day streak') : _('days streak')}
            </div>
          </div>
        </div>

        <div className='text-right'>
          <div className='text-base-content/70 text-sm'>{_('Longest streak')}</div>
          <div className='text-base-content text-xl font-semibold'>
            {_('{{days}} days', { days: longestStreak })}
          </div>
        </div>
      </div>

      {/* Mini streak calendar */}
      <div className='mt-4 flex justify-center gap-2'>
        {last7Days.map((date, i) => {
          const dayDate = new Date(date);
          const dayName = dayDate.toLocaleDateString('en-US', { weekday: 'short' }).charAt(0);
          const isInStreak =
            hasActiveStreak &&
            ((isActiveToday && i >= 7 - currentStreak) ||
              (isActiveYesterday && i >= 6 - currentStreak && i < 6) ||
              lastReadDate === date);

          return (
            <div key={date} className='flex flex-col items-center gap-1'>
              <span className='text-base-content/50 text-xs'>{dayName}</span>
              <div
                className={clsx(
                  'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors',
                  date === today && 'ring-primary ring-2 ring-offset-1',
                  isInStreak ? 'bg-orange-400 text-white' : 'bg-base-300 text-base-content/60',
                )}
              >
                {dayDate.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Status message */}
      <div className='mt-3 text-center'>
        {hasActiveStreak ? (
          isActiveToday ? (
            <span className='text-success text-sm'>{_("You've read today! Keep it up!")}</span>
          ) : (
            <span className='text-warning text-sm'>{_('Read today to maintain your streak!')}</span>
          )
        ) : (
          <span className='text-base-content/50 text-sm'>
            {_('Start reading to begin a streak!')}
          </span>
        )}
      </div>
    </div>
  );
};

export default StreakDisplay;
