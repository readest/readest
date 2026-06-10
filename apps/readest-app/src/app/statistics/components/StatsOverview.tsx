import clsx from 'clsx';
import { PiClock, PiBooks, PiFlame, PiFileText } from 'react-icons/pi';
import { useTranslation } from '@/hooks/useTranslation';
import { UserStatistics, DailyReadingSummary } from '@/types/statistics';
import { getLocalDateString } from '@/utils/format';

interface StatsOverviewProps {
  stats: UserStatistics;
  dailySummaries: Record<string, DailyReadingSummary>;
}

interface StatCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  subtitle?: string;
  className?: string;
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, subtitle, className }) => {
  return (
    <div
      className={clsx(
        'bg-base-200 flex flex-col rounded-xl p-4 shadow-sm transition-shadow hover:shadow-md',
        className,
      )}
    >
      <div className='text-base-content/60 mb-2'>{icon}</div>
      <div className='text-base-content/70 text-sm font-medium'>{label}</div>
      <div className='text-base-content text-2xl font-bold'>{value}</div>
      {subtitle && <div className='text-base-content/50 mt-1 text-xs'>{subtitle}</div>}
    </div>
  );
};

const formatDuration = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
};

const getMonthDateRange = (): { start: string; end: string } => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    start: getLocalDateString(start),
    end: getLocalDateString(end),
  };
};

const StatsOverview: React.FC<StatsOverviewProps> = ({ stats, dailySummaries }) => {
  const _ = useTranslation();

  // Calculate pages this month
  const { start, end } = getMonthDateRange();
  const pagesThisMonth = Object.entries(dailySummaries)
    .filter(([date]) => date >= start && date <= end)
    .reduce((sum, [, summary]) => sum + summary.totalPages, 0);

  return (
    <div className='grid grid-cols-2 gap-4'>
      <StatCard
        icon={<PiClock size={24} />}
        label={_('Total Reading Time')}
        value={formatDuration(stats.totalReadingTime)}
        subtitle={_('{{sessions}} sessions', { sessions: stats.totalSessions })}
      />
      <StatCard
        icon={<PiBooks size={24} />}
        label={_('Books Completed')}
        value={String(stats.totalBooksCompleted)}
        subtitle={_('{{started}} books started', { started: stats.totalBooksStarted })}
      />
      <StatCard
        icon={<PiFlame size={24} />}
        label={_('Current Streak')}
        value={_('{{days}} days', { days: stats.currentStreak })}
        subtitle={_('Longest: {{days}} days', { days: stats.longestStreak })}
        className={stats.currentStreak > 0 ? 'border-2 border-orange-400/30' : ''}
      />
      <StatCard
        icon={<PiFileText size={24} />}
        label={_('Pages This Month')}
        value={String(pagesThisMonth)}
        subtitle={_('Total: {{total}} pages', { total: stats.totalPagesRead })}
      />
    </div>
  );
};

export default StatsOverview;
