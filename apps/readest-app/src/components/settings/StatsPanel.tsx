import React, { useCallback, useEffect, useState } from 'react';
import clsx from 'clsx';
import { MdChevronLeft, MdChevronRight } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import {
  ReadingStatsService,
  type DailyReading,
  type StreakInfo,
  type OverallStats,
} from '@/services/statistics/readingStatsService';
import { formatReadingTime } from '@/utils/formatReadingTime';
import { BoxedList, SettingsRow } from './primitives';
import ReadingHeatmap from './ReadingHeatmap';
import ReadingTrendsChart from './ReadingTrendsChart';

type StatsTab = 'progress' | 'activities';

// ── Skeleton placeholder ─────────────────────────────────────────────

const SkeletonRow: React.FC = () => (
  <div className='flex min-h-14 items-center justify-between px-4'>
    <div className='bg-base-200 h-4 w-28 animate-pulse rounded' />
    <div className='bg-base-200 h-4 w-16 animate-pulse rounded' />
  </div>
);

const SkeletonCard: React.FC = () => (
  <div className='flex flex-col gap-2 p-3 sm:p-4'>
    <div className='bg-base-200 h-4 w-24 animate-pulse rounded' />
    <div className='bg-base-200 h-[180px] w-full animate-pulse rounded-lg' />
  </div>
);

// ── Main component ───────────────────────────────────────────────────

const StatsPanel: React.FC = () => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const [activeTab, setActiveTab] = useState<StatsTab>('progress');
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [dailyData, setDailyData] = useState<DailyReading[]>([]);

  const loadStats = useCallback(
    async (isCancelled: () => boolean) => {
      if (!appService) return;
      setLoading(true);
      try {
        const statsDb = await StatisticsDb.open(appService);
        const service = new ReadingStatsService(statsDb);

        let startISO: string;
        let endISO: string;

        if (activeTab === 'activities') {
          startISO = `${selectedYear}-01-01`;
          endISO = `${selectedYear}-12-31`;
        } else {
          const endDate = new Date();
          const startDate = new Date();
          startDate.setDate(startDate.getDate() - 365);
          startISO = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
          endISO = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
        }

        const [streakInfo, overallStats, daily] = await Promise.all([
          service.getStreakInfo(),
          service.getOverallStats(),
          service.getDailyReadingMap(startISO, endISO),
        ]);

        if (!isCancelled()) {
          setStreak(streakInfo);
          setOverall(overallStats);
          setDailyData(daily);
        }
      } catch (err) {
        console.error('[StatsPanel] Failed to load reading stats:', err);
      } finally {
        if (!isCancelled()) {
          setLoading(false);
        }
      }
    },
    [appService, selectedYear, activeTab],
  );

  useEffect(() => {
    let cancelled = false;
    loadStats(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [loadStats]);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className='settings-content my-2 w-full space-y-5'>
      {/* ── Top Tabs: Progress & Activities (like Strava/Fitness UI) ── */}
      <div className='flex border-b border-base-200 w-full mb-3'>
        <button
          type='button'
          onClick={() => setActiveTab('progress')}
          className={clsx(
            'flex-1 pb-2.5 text-center text-sm font-bold transition-colors relative cursor-pointer',
            activeTab === 'progress'
              ? 'text-base-content font-bold'
              : 'text-base-content/50 hover:text-base-content/80',
          )}
        >
          {_('Progress')}
          {activeTab === 'progress' && (
            <span className='absolute bottom-0 inset-x-0 h-0.5 bg-primary' />
          )}
        </button>
        <button
          type='button'
          onClick={() => setActiveTab('activities')}
          className={clsx(
            'flex-1 pb-2.5 text-center text-sm font-bold transition-colors relative cursor-pointer',
            activeTab === 'activities'
              ? 'text-base-content font-bold'
              : 'text-base-content/50 hover:text-base-content/80',
          )}
        >
          {_('Activities')}
          {activeTab === 'activities' && (
            <span className='absolute bottom-0 inset-x-0 h-0.5 bg-primary' />
          )}
        </button>
      </div>

      {/* ── Tab Content ───────────────────────────────────────────── */}
      {activeTab === 'progress' ? (
        <div className='w-full'>
          <div className='card eink-bordered border-base-200 bg-base-100 border p-3.5 sm:p-5'>
            {loading ? <SkeletonCard /> : <ReadingTrendsChart data={dailyData} />}
          </div>
        </div>
      ) : (
        <div className='w-full'>
          <div className='mb-2 flex items-center justify-between ps-4 pe-2'>
            <span className='text-base-content/65 text-[0.8em] font-semibold tracking-wider uppercase'>
              {_('READING ACTIVITY')}
            </span>
            <div className='flex items-center gap-1 text-xs'>
              <button
                type='button'
                onClick={() => setSelectedYear((y) => y - 1)}
                className='btn btn-ghost btn-xs h-6 w-6 min-h-6 p-0 rounded-full'
                aria-label={_('Previous Year')}
              >
                <MdChevronLeft size={16} />
              </button>
              <span className='text-base-content/80 font-semibold tabular-nums'>
                {selectedYear}
              </span>
              <button
                type='button'
                onClick={() => setSelectedYear((y) => y + 1)}
                disabled={selectedYear >= currentYear}
                className='btn btn-ghost btn-xs h-6 w-6 min-h-6 p-0 rounded-full disabled:opacity-30'
                aria-label={_('Next Year')}
              >
                <MdChevronRight size={16} />
              </button>
            </div>
          </div>
          <div className='card eink-bordered border-base-200 bg-base-100 border'>
            <div className='p-2.5 sm:p-4'>
              {loading ? <SkeletonCard /> : <ReadingHeatmap data={dailyData} year={selectedYear} />}
            </div>
          </div>
        </div>
      )}

      {/* ── Streak Summary ────────────────────────────────────────── */}
      <BoxedList title={_('STREAK')}>
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : (
          <>
            <SettingsRow label={<span>🔥 {_('Current Streak')}</span>}>
              <span className='text-base-content/80 font-medium tabular-nums'>
                {streak?.currentStreak ?? 0} {streak?.currentStreak === 1 ? _('day') : _('days')}
              </span>
            </SettingsRow>
            <SettingsRow label={<span>🏆 {_('Longest Streak')}</span>}>
              <span className='text-base-content/80 font-medium tabular-nums'>
                {streak?.longestStreak ?? 0} {streak?.longestStreak === 1 ? _('day') : _('days')}
              </span>
            </SettingsRow>
          </>
        )}
      </BoxedList>

      {/* ── Reading Summary ───────────────────────────────────────── */}
      <BoxedList title={_('SUMMARY')}>
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : (
          <>
            <SettingsRow label={<span>📖 {_('Today')}</span>}>
              <span className='text-base-content/80 font-medium tabular-nums'>
                {formatReadingTime(overall?.todaySeconds ?? 0)}
              </span>
            </SettingsRow>
            <SettingsRow label={<span>📅 {_('This Week')}</span>}>
              <span className='text-base-content/80 font-medium tabular-nums'>
                {formatReadingTime(overall?.weekSeconds ?? 0)}
              </span>
            </SettingsRow>
            <SettingsRow label={<span>📆 {_('This Month')}</span>}>
              <span className='text-base-content/80 font-medium tabular-nums'>
                {formatReadingTime(overall?.monthSeconds ?? 0)}
              </span>
            </SettingsRow>
            <SettingsRow label={<span>⏱️ {_('All Time')}</span>}>
              <span className='text-base-content/80 font-medium tabular-nums'>
                {formatReadingTime(overall?.totalSeconds ?? 0)}
              </span>
            </SettingsRow>
            <SettingsRow label={<span>📚 {_('Books Read')}</span>}>
              <span className='text-base-content/80 font-medium tabular-nums'>
                {overall?.booksRead ?? 0}
              </span>
            </SettingsRow>
            <SettingsRow label={<span>📄 {_('Pages Read')}</span>}>
              <span className='text-base-content/80 font-medium tabular-nums'>
                {(overall?.totalPages ?? 0).toLocaleString()}
              </span>
            </SettingsRow>
          </>
        )}
      </BoxedList>
    </div>
  );
};

export default StatsPanel;
