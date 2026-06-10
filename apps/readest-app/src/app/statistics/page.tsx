'use client';

import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react';
import 'overlayscrollbars/overlayscrollbars.css';

import { useEnv } from '@/context/EnvContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useStatisticsStore } from '@/store/statisticsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { navigateToLibrary } from '@/utils/nav';

import BottomNav from '@/components/BottomNav';
import StatisticsHeader from './components/StatisticsHeader';
import StatsOverview from './components/StatsOverview';
import StreakDisplay from './components/StreakDisplay';
import ReadingCalendar from './components/ReadingCalendar';
import TrendChart from './components/TrendChart';
import TimeDistribution from './components/TimeDistribution';
import BookStats from './components/BookStats';

const StatisticsPage = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();
  const { loadStatistics, saveStatistics, loaded, userStats, dailySummaries, bookStats } =
    useStatisticsStore();

  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [trendRange, setTrendRange] = useState<'week' | 'month' | 'year'>('week');

  useTheme({ systemUIVisible: false });

  // Always reload from file when statistics page mounts
  // This ensures we get fresh data even if store was cached (hot reload)
  useEffect(() => {
    loadStatistics(envConfig);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envConfig]);

  // Save statistics periodically when the page is active
  useEffect(() => {
    if (!loaded) return;

    const saveInterval = setInterval(() => {
      saveStatistics(envConfig);
    }, 60000); // Save every minute

    return () => clearInterval(saveInterval);
  }, [loaded, saveStatistics, envConfig]);

  const handleGoBack = () => {
    saveStatistics(envConfig);
    navigateToLibrary(router);
  };

  if (!appService) {
    return <div className='bg-base-100 full-height' />;
  }

  const isMobile = appService.isMobile;

  return (
    <div
      className={clsx(
        'statistics-page bg-base-100 full-height inset-0 flex select-none flex-col overflow-hidden',
        appService.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <StatisticsHeader onGoBack={handleGoBack} />

      <OverlayScrollbarsComponent
        defer
        className='flex-1'
        options={{ scrollbars: { autoHide: 'scroll' } }}
      >
        <div
          className='mx-auto max-w-4xl space-y-6 px-4 pb-24 pt-16'
          style={{
            paddingTop: `calc(56px + ${safeAreaInsets?.top || 0}px + ${appService.hasTrafficLight ? 24 : 0}px)`,
            paddingBottom: isMobile ? 'calc(80px + env(safe-area-inset-bottom))' : '24px',
          }}
        >
          {/* Overview Cards */}
          <StatsOverview stats={userStats} dailySummaries={dailySummaries} />

          {/* Streak Display */}
          <StreakDisplay
            currentStreak={userStats.currentStreak}
            longestStreak={userStats.longestStreak}
            lastReadDate={userStats.lastReadDate}
          />

          {/* Reading Calendar */}
          <ReadingCalendar
            year={calendarYear}
            dailySummaries={dailySummaries}
            onYearChange={setCalendarYear}
          />

          {/* Charts Grid */}
          <div className='grid gap-6 md:grid-cols-2'>
            <TrendChart
              dailySummaries={dailySummaries}
              dateRange={trendRange}
              onDateRangeChange={setTrendRange}
            />
            <TimeDistribution stats={userStats} />
          </div>

          {/* Book Statistics */}
          <BookStats bookStats={bookStats} />

          {/* Empty state */}
          {userStats.totalSessions === 0 && (
            <div className='bg-base-200 rounded-xl p-8 text-center'>
              <h3 className='text-base-content mb-2 text-lg font-semibold'>
                {_('No reading data yet')}
              </h3>
              <p className='text-base-content/60 mb-4'>
                {_('Start reading a book to see your statistics here')}
              </p>
              <button className='btn btn-primary' onClick={handleGoBack}>
                {_('Go to Library')}
              </button>
            </div>
          )}
        </div>
      </OverlayScrollbarsComponent>

      {/* Bottom navigation for mobile */}
      {isMobile && <BottomNav />}
    </div>
  );
};

export default StatisticsPage;
