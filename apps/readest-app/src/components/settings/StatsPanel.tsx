import React, { useCallback, useEffect, useState } from 'react';
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

// ── Skeleton placeholder ─────────────────────────────────────────────

const SkeletonRow: React.FC = () => (
  <div className='flex min-h-14 items-center justify-between px-4'>
    <div className='bg-base-200 h-4 w-28 animate-pulse rounded' />
    <div className='bg-base-200 h-4 w-16 animate-pulse rounded' />
  </div>
);

const SkeletonHeatmap: React.FC = () => (
  <div className='flex flex-col gap-2 p-4'>
    <div className='bg-base-200 h-4 w-24 animate-pulse rounded' />
    <div className='bg-base-200 h-[110px] w-full animate-pulse rounded-lg' />
  </div>
);

// ── Main component ───────────────────────────────────────────────────

const StatsPanel: React.FC = () => {
  const _ = useTranslation();
  const { appService } = useEnv();

  const [loading, setLoading] = useState(true);
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [overall, setOverall] = useState<OverallStats | null>(null);
  const [dailyData, setDailyData] = useState<DailyReading[]>([]);

  const loadStats = useCallback(async () => {
    if (!appService) return;
    try {
      const statsDb = await StatisticsDb.open(appService);
      const service = new ReadingStatsService(statsDb);

      // Heatmap range: ~52 weeks back from today.
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 365);
      const startISO = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
      const endISO = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;

      const [streakInfo, overallStats, daily] = await Promise.all([
        service.getStreakInfo(),
        service.getOverallStats(),
        service.getDailyReadingMap(startISO, endISO),
      ]);

      setStreak(streakInfo);
      setOverall(overallStats);
      setDailyData(daily);
    } catch (err) {
      console.error('[StatsPanel] Failed to load reading stats:', err);
    } finally {
      setLoading(false);
    }
  }, [appService]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div className='settings-content my-4 w-full space-y-6'>
      {/* Panel header */}
      <div className='w-full'>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Reading Stats')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Track your reading habits and streaks')}
        </p>
      </div>

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

      {/* ── Contribution Heatmap ──────────────────────────────────── */}
      <BoxedList title={_('READING ACTIVITY')} innerClassName='ps-0!'>
        <div className='p-4'>
          {loading ? <SkeletonHeatmap /> : <ReadingHeatmap data={dailyData} />}
        </div>
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
