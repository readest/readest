'use client';

import React, { useState, useEffect } from 'react';
import { useStatisticsStore } from '@/store/statisticsStore';

/**
 * Temporary debug component for viewing statistics data.
 * TODO: Remove this component before production release.
 */
const StatisticsDebug: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Update timestamp every second when panel is open
  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const sessions = useStatisticsStore((state) => state.sessions);
  const dailySummaries = useStatisticsStore((state) => state.dailySummaries);
  const bookStats = useStatisticsStore((state) => state.bookStats);
  const userStats = useStatisticsStore((state) => state.userStats);
  const activeSessions = useStatisticsStore((state) => state.activeSessions);
  const { getCalendarData, computeStreaks, recomputeAllStats } = useStatisticsStore();

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    }
    return `${mins}m ${secs}s`;
  };

  const handleRefreshStreaks = () => {
    computeStreaks();
  };

  const handleRecomputeAll = () => {
    recomputeAllStats();
  };

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className='fixed bottom-20 right-4 z-50 rounded-full bg-orange-500 px-3 py-1 text-xs font-bold text-white shadow-lg hover:bg-orange-600'
        title='Open Statistics Debug'
      >
        📊 Stats
      </button>
    );
  }

  const calendarData = getCalendarData();
  const activeSessionsList = Object.entries(activeSessions);

  return (
    <div className='fixed bottom-20 right-4 z-50 max-h-[70vh] w-96 overflow-auto rounded-lg border border-gray-300 bg-white p-4 text-xs shadow-xl dark:border-gray-600 dark:bg-gray-800'>
      <div className='mb-3 flex items-center justify-between'>
        <h3 className='text-sm font-bold'>📊 Statistics Debug</h3>
        <button
          onClick={() => setIsOpen(false)}
          className='text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
        >
          ✕
        </button>
      </div>

      {/* User Stats */}
      <section className='mb-3'>
        <h4 className='mb-1 font-semibold text-blue-600 dark:text-blue-400'>User Stats</h4>
        <div className='grid grid-cols-2 gap-1 text-gray-700 dark:text-gray-300'>
          <span>Total Reading:</span>
          <span className='font-mono'>{formatDuration(userStats.totalReadingTime)}</span>
          <span>Sessions:</span>
          <span className='font-mono'>{userStats.totalSessions}</span>
          <span>Pages Read:</span>
          <span className='font-mono'>{userStats.totalPagesRead}</span>
          <span>Books Started:</span>
          <span className='font-mono'>{userStats.totalBooksStarted}</span>
          <span>Books Completed:</span>
          <span className='font-mono'>{userStats.totalBooksCompleted}</span>
          <span>Current Streak:</span>
          <span className='font-mono'>{userStats.currentStreak} days</span>
          <span>Longest Streak:</span>
          <span className='font-mono'>{userStats.longestStreak} days</span>
          <span>Last Read:</span>
          <span className='font-mono'>{userStats.lastReadDate || 'Never'}</span>
        </div>
      </section>

      {/* Active Sessions */}
      <section className='mb-3'>
        <h4 className='mb-1 font-semibold text-green-600 dark:text-green-400'>
          Active Sessions ({activeSessionsList.length})
        </h4>
        {activeSessionsList.length === 0 ? (
          <p className='italic text-gray-500'>No active sessions</p>
        ) : (
          <ul className='space-y-1'>
            {activeSessionsList.map(([key, session]) => (
              <li key={key} className='rounded bg-green-50 p-1 dark:bg-green-900/30'>
                <div className='font-mono text-[10px]'>{key.slice(0, 20)}...</div>
                <div className='text-gray-600 dark:text-gray-400'>
                  Page {session.startPage} → {session.lastPage} | Started{' '}
                  {Math.floor((now - session.startTime) / 1000)}s ago
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Recent Sessions */}
      <section className='mb-3'>
        <h4 className='mb-1 font-semibold text-purple-600 dark:text-purple-400'>
          Recent Sessions ({sessions.length} total)
        </h4>
        {sessions.length === 0 ? (
          <p className='italic text-gray-500'>No completed sessions</p>
        ) : (
          <ul className='space-y-1'>
            {sessions
              .slice(-5)
              .reverse()
              .map((session) => (
                <li key={session.id} className='rounded bg-purple-50 p-1 dark:bg-purple-900/30'>
                  <div className='font-mono text-[10px]'>{session.bookHash.slice(0, 16)}...</div>
                  <div className='text-gray-600 dark:text-gray-400'>
                    {formatDuration(session.duration)} | Pages {session.startPage}-{session.endPage}{' '}
                    | {new Date(session.startTime).toLocaleTimeString()}
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Daily Summaries */}
      <section className='mb-3'>
        <h4 className='mb-1 font-semibold text-orange-600 dark:text-orange-400'>
          Daily Summaries ({Object.keys(dailySummaries).length} days)
        </h4>
        {Object.keys(dailySummaries).length === 0 ? (
          <p className='italic text-gray-500'>No daily data</p>
        ) : (
          <ul className='space-y-1'>
            {Object.entries(dailySummaries)
              .sort(([a], [b]) => b.localeCompare(a))
              .slice(0, 5)
              .map(([date, summary]) => (
                <li key={date} className='rounded bg-orange-50 p-1 dark:bg-orange-900/30'>
                  <span className='font-mono'>{date}</span>:{' '}
                  <span className='text-gray-600 dark:text-gray-400'>
                    {formatDuration(summary.totalDuration)} | {summary.sessionsCount} sessions |{' '}
                    {summary.totalPages} pages
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Book Stats */}
      <section className='mb-3'>
        <h4 className='mb-1 font-semibold text-teal-600 dark:text-teal-400'>
          Book Stats ({Object.keys(bookStats).length} books)
        </h4>
        {Object.keys(bookStats).length === 0 ? (
          <p className='italic text-gray-500'>No book stats</p>
        ) : (
          <ul className='space-y-1'>
            {Object.entries(bookStats)
              .slice(0, 3)
              .map(([hash, stats]) => (
                <li key={hash} className='rounded bg-teal-50 p-1 dark:bg-teal-900/30'>
                  <div className='font-mono text-[10px]'>{hash.slice(0, 16)}...</div>
                  <div className='text-gray-600 dark:text-gray-400'>
                    {formatDuration(stats.totalReadingTime)} | {stats.totalSessions} sessions |{' '}
                    {stats.totalPagesRead} pages
                  </div>
                </li>
              ))}
          </ul>
        )}
      </section>

      {/* Calendar Data (current year) */}
      <section className='mb-3'>
        <h4 className='mb-1 font-semibold text-indigo-600 dark:text-indigo-400'>
          Calendar Data ({Object.keys(calendarData).length} days this year)
        </h4>
        {Object.keys(calendarData).length === 0 ? (
          <p className='italic text-gray-500'>No calendar data</p>
        ) : (
          <div className='font-mono text-[10px] text-gray-600 dark:text-gray-400'>
            {Object.entries(calendarData)
              .sort(([a], [b]) => b.localeCompare(a))
              .slice(0, 5)
              .map(([date, duration]) => `${date}: ${formatDuration(duration)}`)
              .join(' | ')}
          </div>
        )}
      </section>

      {/* Actions */}
      <section className='flex gap-2 border-t border-gray-200 pt-2 dark:border-gray-600'>
        <button
          onClick={handleRefreshStreaks}
          className='rounded bg-blue-500 px-2 py-1 text-white hover:bg-blue-600'
        >
          Refresh Streaks
        </button>
        <button
          onClick={handleRecomputeAll}
          className='rounded bg-red-500 px-2 py-1 text-white hover:bg-red-600'
        >
          Recompute All
        </button>
        <button
          onClick={() => console.log(useStatisticsStore.getState())}
          className='rounded bg-gray-500 px-2 py-1 text-white hover:bg-gray-600'
        >
          Log to Console
        </button>
      </section>
    </div>
  );
};

export default StatisticsDebug;
