import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

import {
  ReadingSession,
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

// Helper to get days difference between two dates
const getDaysDifference = (date1: string, date2: string): number => {
  const d1 = new Date(date1);
  const d2 = new Date(date2);
  const diffTime = Math.abs(d2.getTime() - d1.getTime());
  return Math.floor(diffTime / (1000 * 60 * 60 * 24));
};

// Helper to get yesterday's date string
const getYesterdayString = (): string => {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return getDateString(yesterday.getTime());
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
  getCalendarData: (year?: number) => Record<string, number>;

  // Aggregation
  computeStreaks: () => void;
  recomputeAllStats: () => void;

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

    set((state) => ({
      activeSessions: {
        ...state.activeSessions,
        [bookKey]: {
          ...session,
          lastActivityTime: Date.now(),
          lastProgress: progress,
          lastPage: page,
        },
      },
    }));
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

    const pagesRead = Math.max(0, activeSession.lastPage - activeSession.startPage);

    const session: ReadingSession = {
      id: uuidv4(),
      bookHash: activeSession.bookHash,
      metaHash: activeSession.metaHash,
      startTime: activeSession.startTime,
      endTime: now,
      duration,
      startProgress: activeSession.startProgress,
      endProgress: activeSession.lastProgress,
      startPage: activeSession.startPage,
      endPage: activeSession.lastPage,
      pagesRead,
      createdAt: now,
      updatedAt: now,
    };

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

  getCalendarData: (year) => {
    const { dailySummaries } = get();
    const targetYear = year ?? new Date().getFullYear();
    const result: Record<string, number> = {};

    // Get all dates for the target year
    Object.entries(dailySummaries).forEach(([date, summary]) => {
      if (date.startsWith(String(targetYear))) {
        result[date] = summary.totalDuration;
      }
    });

    return result;
  },

  computeStreaks: () => {
    const { dailySummaries, userStats } = get();
    const today = getDateString();
    const yesterday = getYesterdayString();

    // Get sorted dates that have reading activity
    const readingDates = Object.keys(dailySummaries)
      .filter((date) => dailySummaries[date]!.totalDuration > 0)
      .sort();

    if (readingDates.length === 0) {
      set((state) => ({
        userStats: {
          ...state.userStats,
          currentStreak: 0,
          longestStreak: 0,
        },
      }));
      return;
    }

    // Calculate current streak (must include today or yesterday)
    let currentStreak = 0;
    const lastReadDate = readingDates[readingDates.length - 1]!;

    if (lastReadDate === today || lastReadDate === yesterday) {
      currentStreak = 1;
      let checkDate = lastReadDate;

      // Count consecutive days backwards
      for (let i = readingDates.length - 2; i >= 0; i--) {
        const prevDate = readingDates[i]!;
        const daysDiff = getDaysDifference(prevDate, checkDate);

        if (daysDiff === 1) {
          currentStreak++;
          checkDate = prevDate;
        } else {
          break;
        }
      }
    }

    // Calculate longest streak
    let longestStreak = 1;
    let tempStreak = 1;

    for (let i = 1; i < readingDates.length; i++) {
      const daysDiff = getDaysDifference(readingDates[i - 1]!, readingDates[i]!);

      if (daysDiff === 1) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 1;
      }
    }

    // Only update if values changed
    if (currentStreak !== userStats.currentStreak || longestStreak !== userStats.longestStreak) {
      set((state) => ({
        userStats: {
          ...state.userStats,
          currentStreak,
          longestStreak,
        },
      }));
    }
  },

  recomputeAllStats: () => {
    const { sessions } = get();

    if (sessions.length === 0) {
      set({
        dailySummaries: {},
        bookStats: {},
        userStats: DEFAULT_USER_STATISTICS,
      });
      return;
    }

    // Rebuild daily summaries
    const newDailySummaries: Record<string, DailyReadingSummary> = {};

    // Rebuild book stats
    const newBookStats: Record<string, BookStatistics> = {};

    // Rebuild user stats
    let totalReadingTime = 0;
    let totalPagesRead = 0;
    const uniqueBooks = new Set<string>();
    const readingByHour = new Array(24).fill(0) as number[];
    const readingByDayOfWeek = new Array(7).fill(0) as number[];

    sessions.forEach((session) => {
      const dateStr = getDateString(session.startTime);
      const hour = getHour(session.startTime);
      const dayOfWeek = getDayOfWeek(session.startTime);

      // Update daily summary
      const existing = newDailySummaries[dateStr];
      if (existing) {
        existing.totalDuration += session.duration;
        existing.totalPages += session.pagesRead;
        existing.sessionsCount += 1;
        if (!existing.booksRead.includes(session.bookHash)) {
          existing.booksRead.push(session.bookHash);
        }
      } else {
        newDailySummaries[dateStr] = {
          date: dateStr,
          totalDuration: session.duration,
          totalPages: session.pagesRead,
          sessionsCount: 1,
          booksRead: [session.bookHash],
        };
      }

      // Update book stats
      const bookStat = newBookStats[session.bookHash];
      if (bookStat) {
        bookStat.totalReadingTime += session.duration;
        bookStat.totalSessions += 1;
        bookStat.totalPagesRead += session.pagesRead;
        bookStat.lastReadAt = Math.max(bookStat.lastReadAt, session.endTime);
        if (session.endProgress >= 0.99 && !bookStat.completedAt) {
          bookStat.completedAt = session.endTime;
        }
      } else {
        newBookStats[session.bookHash] = {
          bookHash: session.bookHash,
          metaHash: session.metaHash,
          totalReadingTime: session.duration,
          totalSessions: 1,
          totalPagesRead: session.pagesRead,
          averageSessionDuration: session.duration,
          averageReadingSpeed:
            session.duration > 0 ? session.pagesRead / (session.duration / 3600) : 0,
          firstReadAt: session.startTime,
          lastReadAt: session.endTime,
          completedAt: session.endProgress >= 0.99 ? session.endTime : undefined,
        };
      }

      // Update user totals
      totalReadingTime += session.duration;
      totalPagesRead += session.pagesRead;
      uniqueBooks.add(session.bookHash);
      readingByHour[hour] += session.duration;
      readingByDayOfWeek[dayOfWeek] += session.duration;
    });

    // Calculate averages for book stats
    Object.values(newBookStats).forEach((stat) => {
      stat.averageSessionDuration = stat.totalReadingTime / stat.totalSessions;
      stat.averageReadingSpeed =
        stat.totalReadingTime > 0 ? stat.totalPagesRead / (stat.totalReadingTime / 3600) : 0;
    });

    // Count completed books
    const completedBooks = Object.values(newBookStats).filter((bs) => bs.completedAt).length;

    // Calculate average daily reading time
    const daysWithReading = Object.keys(newDailySummaries).length;
    const averageDailyReadingTime = daysWithReading > 0 ? totalReadingTime / daysWithReading : 0;

    // Get last read date
    const sortedDates = Object.keys(newDailySummaries).sort();
    const lastReadDate = sortedDates[sortedDates.length - 1] || '';

    set({
      dailySummaries: newDailySummaries,
      bookStats: newBookStats,
      userStats: {
        totalReadingTime,
        totalBooksStarted: uniqueBooks.size,
        totalBooksCompleted: completedBooks,
        totalPagesRead,
        totalSessions: sessions.length,
        currentStreak: 0, // Will be computed by computeStreaks
        longestStreak: 0, // Will be computed by computeStreaks
        lastReadDate,
        averageSessionDuration: sessions.length > 0 ? totalReadingTime / sessions.length : 0,
        averageDailyReadingTime,
        readingByHour,
        readingByDayOfWeek,
      },
    });

    // Compute streaks after rebuilding
    get().computeStreaks();
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

      // Compute streaks on load (in case days have passed since last session)
      get().computeStreaks();

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
