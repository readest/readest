import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

import {
  ReadingSession,
  PageReadingStat,
  DailyReadingSummary,
  BookStatistics,
  UserStatistics,
  StatisticsConfig,
  ActiveSession,
  StatisticsData,
  DEFAULT_STATISTICS_CONFIG,
  DEFAULT_USER_STATISTICS,
  DEFAULT_STATISTICS_DATA,
  CURRENT_STATISTICS_VERSION,
} from '@/types/statistics';
import { EnvConfigType } from '@/services/environment';

const STATISTICS_FILENAME = 'statistics.json';

// Helper to get date string in YYYY-MM-DD format (local timezone)
const getDateString = (timestamp: number = Date.now()): string => {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper to get hour from timestamp (0-23)
const getHour = (timestamp: number): number => {
  return new Date(timestamp).getHours();
};

// Helper to get day of week from timestamp (0=Sunday)
const getDayOfWeek = (timestamp: number): number => {
  return new Date(timestamp).getDay();
};

interface StatisticsStore {
  // State
  sessions: ReadingSession[];
  dailySummaries: Record<string, DailyReadingSummary>;
  bookStats: Record<string, BookStatistics>;
  userStats: UserStatistics;
  config: StatisticsConfig;
  activeSessions: Record<string, ActiveSession>;
  loaded: boolean;

  // Session lifecycle
  startSession: (
    bookKey: string,
    bookHash: string,
    metaHash: string | undefined,
    progress: number,
    page: number,
    totalPages: number,
  ) => void;
  updateSessionActivity: (bookKey: string, progress: number, page: number) => void;
  endSession: (bookKey: string, reason: 'closed' | 'idle' | 'switched') => ReadingSession | null;
  endAllSessions: () => void;

  // Data access
  getBookStatistics: (bookHash: string) => BookStatistics | null;
  getDailySummary: (date: string) => DailyReadingSummary | null;
  getSessionsForBook: (bookHash: string, limit?: number) => ReadingSession[];
  getRecentSessions: (limit?: number) => ReadingSession[];

  // Persistence
  loadStatistics: (envConfig: EnvConfigType) => Promise<void>;
  saveStatistics: (envConfig: EnvConfigType) => Promise<void>;

  // Config
  setConfig: (config: Partial<StatisticsConfig>) => void;
}

export const useStatisticsStore = create<StatisticsStore>((set, get) => ({
  sessions: [],
  dailySummaries: {},
  bookStats: {},
  userStats: DEFAULT_USER_STATISTICS,
  config: DEFAULT_STATISTICS_CONFIG,
  activeSessions: {},
  loaded: false,

  startSession: (bookKey, bookHash, metaHash, progress, page, totalPages) => {
    const { config, activeSessions } = get();
    if (!config.trackingEnabled) return;

    // If there's already an active session for this book key, don't start a new one
    if (activeSessions[bookKey]) {
      return;
    }

    const now = Date.now();
    const session: ActiveSession = {
      bookKey,
      bookHash,
      metaHash,
      startTime: now,
      startProgress: progress,
      startPage: page,
      lastActivityTime: now,
      lastProgress: progress,
      lastPage: page,
      totalPages,
      // Initialize page-level tracking
      currentPage: {
        page,
        enteredAt: now,
      },
      pageStats: [],
    };

    set((state) => ({
      activeSessions: {
        ...state.activeSessions,
        [bookKey]: session,
      },
    }));

    console.log('[Statistics] Started session for', bookKey, 'at page', page);
  },

  updateSessionActivity: (bookKey, progress, page) => {
    const { activeSessions, config } = get();
    if (!config.trackingEnabled) return;

    const session = activeSessions[bookKey];
    if (!session) return;

    const now = Date.now();
    const currentPage = session.currentPage;

    // Check if page changed
    if (page !== currentPage.page) {
      // Calculate time spent on the previous page
      const timeOnPage = Math.floor((now - currentPage.enteredAt) / 1000);

      // Apply KOReader-style min/max limits
      const { minimumPageSeconds, maximumPageSeconds } = config;
      const clampedDuration = Math.min(Math.max(timeOnPage, 0), maximumPageSeconds);

      // Only record if above minimum threshold
      const newPageStats = [...session.pageStats];
      if (clampedDuration >= minimumPageSeconds) {
        const pageStat: PageReadingStat = {
          bookHash: session.bookHash,
          page: currentPage.page,
          startTime: Math.floor(currentPage.enteredAt / 1000),
          duration: clampedDuration,
          totalPages: session.totalPages,
        };
        newPageStats.push(pageStat);
        console.log('[Statistics] Recorded', clampedDuration, 'seconds on page', currentPage.page);
      }

      // Update session with new page
      set((state) => ({
        activeSessions: {
          ...state.activeSessions,
          [bookKey]: {
            ...session,
            lastActivityTime: now,
            lastProgress: progress,
            lastPage: page,
            currentPage: {
              page,
              enteredAt: now,
            },
            pageStats: newPageStats,
          },
        },
      }));
    } else {
      // Same page, just update activity time
      set((state) => ({
        activeSessions: {
          ...state.activeSessions,
          [bookKey]: {
            ...session,
            lastActivityTime: now,
            lastProgress: progress,
            lastPage: page,
          },
        },
      }));
    }
  },

  endSession: (bookKey, reason) => {
    const { activeSessions, config, dailySummaries, bookStats } = get();
    if (!config.trackingEnabled) return null;

    const activeSession = activeSessions[bookKey];
    if (!activeSession) return null;

    const now = Date.now();
    const duration = Math.floor((now - activeSession.startTime) / 1000);

    // Don't record sessions shorter than minimum
    if (duration < config.minimumSessionSeconds) {
      set((state) => {
        const newActiveSessions = { ...state.activeSessions };
        delete newActiveSessions[bookKey];
        return { activeSessions: newActiveSessions };
      });
      console.log(
        '[Statistics] Session too short, discarding',
        duration,
        'seconds, reason:',
        reason,
      );
      return null;
    }

    // Record time on the final page
    const finalPageStats = [...activeSession.pageStats];
    const currentPage = activeSession.currentPage;
    const timeOnFinalPage = Math.floor((now - currentPage.enteredAt) / 1000);
    const { minimumPageSeconds, maximumPageSeconds } = config;
    const clampedFinalDuration = Math.min(Math.max(timeOnFinalPage, 0), maximumPageSeconds);

    if (clampedFinalDuration >= minimumPageSeconds) {
      finalPageStats.push({
        bookHash: activeSession.bookHash,
        page: currentPage.page,
        startTime: Math.floor(currentPage.enteredAt / 1000),
        duration: clampedFinalDuration,
        totalPages: activeSession.totalPages,
      });
      console.log(
        '[Statistics] Recorded',
        clampedFinalDuration,
        'seconds on final page',
        currentPage.page,
      );
    }

    const pagesRead = Math.max(0, activeSession.lastPage - activeSession.startPage);

    // Calculate total duration from page stats (more accurate than session timing)
    const pageStatsDuration = finalPageStats.reduce((sum, ps) => sum + ps.duration, 0);
    // Use the larger of session duration or page stats sum (accounts for idle time)
    const finalDuration = Math.max(duration, pageStatsDuration);

    const session: ReadingSession = {
      id: uuidv4(),
      bookHash: activeSession.bookHash,
      metaHash: activeSession.metaHash,
      startTime: activeSession.startTime,
      endTime: now,
      duration: finalDuration,
      startProgress: activeSession.startProgress,
      endProgress: activeSession.lastProgress,
      startPage: activeSession.startPage,
      endPage: activeSession.lastPage,
      pagesRead,
      pageStats: finalPageStats.length > 0 ? finalPageStats : undefined,
      createdAt: now,
      updatedAt: now,
    };

    console.log(
      '[Statistics] Session ended with',
      finalPageStats.length,
      'page stats, total',
      finalDuration,
      'seconds',
    );

    // Update daily summary
    const dateStr = getDateString(activeSession.startTime);
    const existingSummary = dailySummaries[dateStr];
    const updatedSummary: DailyReadingSummary = existingSummary
      ? {
          ...existingSummary,
          totalDuration: existingSummary.totalDuration + duration,
          totalPages: existingSummary.totalPages + pagesRead,
          sessionsCount: existingSummary.sessionsCount + 1,
          booksRead: existingSummary.booksRead.includes(session.bookHash)
            ? existingSummary.booksRead
            : [...existingSummary.booksRead, session.bookHash],
        }
      : {
          date: dateStr,
          totalDuration: duration,
          totalPages: pagesRead,
          sessionsCount: 1,
          booksRead: [session.bookHash],
        };

    // Update book statistics
    const existingBookStats = bookStats[session.bookHash];
    const updatedBookStats: BookStatistics = existingBookStats
      ? {
          ...existingBookStats,
          totalReadingTime: existingBookStats.totalReadingTime + duration,
          totalSessions: existingBookStats.totalSessions + 1,
          totalPagesRead: existingBookStats.totalPagesRead + pagesRead,
          averageSessionDuration:
            (existingBookStats.totalReadingTime + duration) / (existingBookStats.totalSessions + 1),
          averageReadingSpeed:
            (existingBookStats.totalPagesRead + pagesRead) /
            ((existingBookStats.totalReadingTime + duration) / 3600),
          lastReadAt: now,
          completedAt: session.endProgress >= 0.99 ? now : existingBookStats.completedAt,
        }
      : {
          bookHash: session.bookHash,
          metaHash: session.metaHash,
          totalReadingTime: duration,
          totalSessions: 1,
          totalPagesRead: pagesRead,
          averageSessionDuration: duration,
          averageReadingSpeed: duration > 0 ? pagesRead / (duration / 3600) : 0,
          firstReadAt: now,
          lastReadAt: now,
          completedAt: session.endProgress >= 0.99 ? now : undefined,
        };

    set((state) => {
      const newActiveSessions = { ...state.activeSessions };
      delete newActiveSessions[bookKey];

      // Update user stats
      const hour = getHour(activeSession.startTime);
      const dayOfWeek = getDayOfWeek(activeSession.startTime);
      const newReadingByHour = [...state.userStats.readingByHour];
      const newReadingByDayOfWeek = [...state.userStats.readingByDayOfWeek];
      newReadingByHour[hour] = (newReadingByHour[hour] || 0) + duration;
      newReadingByDayOfWeek[dayOfWeek] = (newReadingByDayOfWeek[dayOfWeek] || 0) + duration;

      const newTotalReadingTime = state.userStats.totalReadingTime + duration;
      const newTotalSessions = state.userStats.totalSessions + 1;
      const newTotalPagesRead = state.userStats.totalPagesRead + pagesRead;

      // Count unique books started
      const uniqueBooks = new Set(state.sessions.map((s) => s.bookHash));
      uniqueBooks.add(session.bookHash);

      // Count completed books
      const completedBooks = Object.values({
        ...state.bookStats,
        [session.bookHash]: updatedBookStats,
      }).filter((bs) => bs.completedAt).length;

      return {
        activeSessions: newActiveSessions,
        sessions: [...state.sessions, session],
        dailySummaries: {
          ...state.dailySummaries,
          [dateStr]: updatedSummary,
        },
        bookStats: {
          ...state.bookStats,
          [session.bookHash]: updatedBookStats,
        },
        userStats: {
          ...state.userStats,
          totalReadingTime: newTotalReadingTime,
          totalSessions: newTotalSessions,
          totalPagesRead: newTotalPagesRead,
          totalBooksStarted: uniqueBooks.size,
          totalBooksCompleted: completedBooks,
          averageSessionDuration: newTotalReadingTime / newTotalSessions,
          lastReadDate: dateStr,
          readingByHour: newReadingByHour,
          readingByDayOfWeek: newReadingByDayOfWeek,
        },
      };
    });

    console.log(
      '[Statistics] Ended session for',
      bookKey,
      'reason:',
      reason,
      'duration:',
      duration,
      'seconds',
    );
    return session;
  },

  endAllSessions: () => {
    const { activeSessions, endSession } = get();
    Object.keys(activeSessions).forEach((bookKey) => {
      endSession(bookKey, 'closed');
    });
  },

  getBookStatistics: (bookHash) => {
    return get().bookStats[bookHash] || null;
  },

  getDailySummary: (date) => {
    return get().dailySummaries[date] || null;
  },

  getSessionsForBook: (bookHash, limit = 100) => {
    return get()
      .sessions.filter((s) => s.bookHash === bookHash)
      .slice(-limit);
  },

  getRecentSessions: (limit = 10) => {
    return get().sessions.slice(-limit).reverse();
  },

  loadStatistics: async (envConfig) => {
    try {
      const appService = await envConfig.getAppService();
      let data: StatisticsData;

      if (await appService.exists(STATISTICS_FILENAME, 'Settings')) {
        const content = await appService.readFile(STATISTICS_FILENAME, 'Settings', 'text');
        data = JSON.parse(content as string) as StatisticsData;
        console.log('[Statistics] Loaded from file:', data.sessions?.length || 0, 'sessions');
      } else {
        data = DEFAULT_STATISTICS_DATA;
        console.log('[Statistics] No file found, using defaults');
      }

      set({
        sessions: data.sessions || [],
        dailySummaries: data.dailySummaries || {},
        bookStats: data.bookStats || {},
        userStats: { ...DEFAULT_USER_STATISTICS, ...data.userStats },
        config: { ...DEFAULT_STATISTICS_CONFIG, ...data.config },
        loaded: true,
      });

      console.log(
        '[Statistics] Loaded statistics data, now have',
        get().sessions.length,
        'sessions',
      );
    } catch (error) {
      console.error('[Statistics] Failed to load statistics:', error);
      set({
        ...DEFAULT_STATISTICS_DATA,
        loaded: true,
      });
    }
  },

  saveStatistics: async (envConfig) => {
    try {
      const appService = await envConfig.getAppService();
      const { sessions, dailySummaries, bookStats, userStats, config } = get();

      console.log('[Statistics] Saving with', sessions.length, 'sessions');

      const data: StatisticsData = {
        version: CURRENT_STATISTICS_VERSION,
        sessions,
        dailySummaries,
        bookStats,
        userStats,
        config,
        lastUpdated: Date.now(),
      };

      await appService.writeFile(STATISTICS_FILENAME, 'Settings', JSON.stringify(data, null, 2));

      console.log('[Statistics] Saved statistics data successfully');
    } catch (error) {
      console.error('[Statistics] Failed to save statistics:', error);
    }
  },

  setConfig: (configUpdate) => {
    set((state) => ({
      config: {
        ...state.config,
        ...configUpdate,
      },
    }));
  },
}));
