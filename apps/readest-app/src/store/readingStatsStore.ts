import { create } from 'zustand';
import {
  ReadingSession,
  ReadingStats,
  DailyStats,
  MonthlyStats,
  YearlyStats,
  WordCloudItem,
} from '@/types/readingStats';

interface ReadingStatsStore {
  stats: ReadingStats;
  currentSession: ReadingSession | null;

  // 开始阅读会话
  startSession: (bookHash: string, bookTitle: string, startProgress: number) => void;
  // 结束阅读会话
  endSession: (endProgress: number, pagesRead: number) => void;
  // 获取每日统计
  getDailyStats: (date: string) => DailyStats | null;
  // 获取月度统计
  getMonthlyStats: (year: number, month: number) => MonthlyStats | null;
  // 获取年度统计
  getYearlyStats: (year: number) => YearlyStats | null;
  // 获取词云数据
  getWordCloudData: (limit?: number) => WordCloudItem[];
  // 清空统计
  clearStats: () => void;
}

const initialStats: ReadingStats = {
  sessions: [],
};

export const useReadingStatsStore = create<ReadingStatsStore>((set, get) => ({
  stats: initialStats,
  currentSession: null,

  startSession: (bookHash: string, bookTitle: string, startProgress: number) => {
    set(() => ({
      currentSession: {
        id: Date.now().toString(),
        bookHash,
        bookTitle,
        startTime: Date.now(),
        endTime: 0,
        duration: 0,
        pagesRead: 0,
        startProgress,
        endProgress: startProgress,
      },
    }));
  },

  endSession: (endProgress: number, pagesRead: number) => {
    set((state) => {
      if (!state.currentSession) return state;

      const endTime = Date.now();
      const duration = Math.floor((endTime - state.currentSession.startTime) / 1000);

      const completedSession: ReadingSession = {
        ...state.currentSession,
        endTime,
        duration,
        pagesRead,
        endProgress,
      };

      return {
        stats: {
          ...state.stats,
          sessions: [...state.stats.sessions, completedSession],
        },
        currentSession: null,
      };
    });
  },

  getDailyStats: (date: string) => {
    const { stats } = get();
    const sessionsOnDate = stats.sessions.filter(
      (session) => new Date(session.startTime).toISOString().split('T')[0] === date,
    );

    if (sessionsOnDate.length === 0) return null;

    const uniqueBooks = new Set(sessionsOnDate.map((s) => s.bookHash));
    const totalDuration = sessionsOnDate.reduce((sum, s) => sum + s.duration, 0);
    const totalPages = sessionsOnDate.reduce((sum, s) => sum + s.pagesRead, 0);

    return {
      date,
      totalDuration,
      booksRead: uniqueBooks.size,
      pagesRead: totalPages,
      sessions: sessionsOnDate.length,
    };
  },

  getMonthlyStats: (year: number, month: number) => {
    const { stats } = get();
    const sessionsInMonth = stats.sessions.filter((session) => {
      const d = new Date(session.startTime);
      return d.getFullYear() === year && d.getMonth() + 1 === month;
    });

    if (sessionsInMonth.length === 0) return null;

    const uniqueBooks = new Set(sessionsInMonth.map((s) => s.bookHash));
    const totalDuration = sessionsInMonth.reduce((sum, s) => sum + s.duration, 0);
    const totalPages = sessionsInMonth.reduce((sum, s) => sum + s.pagesRead, 0);

    // 生成每日统计
    const dailyStatsMap: Map<string, DailyStats> = new Map();
    sessionsInMonth.forEach((session) => {
      const date = new Date(session.startTime).toISOString().split('T')[0]!;
      const existing = dailyStatsMap.get(date);
      if (existing) {
        dailyStatsMap.set(date, {
          ...existing,
          totalDuration: existing.totalDuration + session.duration,
          pagesRead: existing.pagesRead + session.pagesRead,
          sessions: existing.sessions + 1,
          booksRead: existing.booksRead + 1,
        });
      } else {
        dailyStatsMap.set(date, {
          date,
          totalDuration: session.duration,
          pagesRead: session.pagesRead,
          sessions: 1,
          booksRead: 1,
        });
      }
    });

    const dailyStats = Array.from(dailyStatsMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    return {
      year,
      month,
      totalDuration,
      booksRead: uniqueBooks.size,
      pagesRead: totalPages,
      dailyStats,
    };
  },

  getYearlyStats: (year: number) => {
    const { stats } = get();
    const sessionsInYear = stats.sessions.filter(
      (session) => new Date(session.startTime).getFullYear() === year,
    );

    if (sessionsInYear.length === 0) return null;

    const uniqueBooks = new Set(sessionsInYear.map((s) => s.bookHash));
    const totalDuration = sessionsInYear.reduce((sum, s) => sum + s.duration, 0);
    const totalPages = sessionsInYear.reduce((sum, s) => sum + s.pagesRead, 0);

    // 生成月度统计
    const monthlyStatsMap: Map<number, MonthlyStats> = new Map();
    sessionsInYear.forEach((session) => {
      const month = new Date(session.startTime).getMonth() + 1;
      const existing = monthlyStatsMap.get(month);
      if (existing) {
        monthlyStatsMap.set(month, {
          ...existing,
          totalDuration: existing.totalDuration + session.duration,
          pagesRead: existing.pagesRead + session.pagesRead,
        });
      } else {
        monthlyStatsMap.set(month, {
          year,
          month,
          totalDuration: session.duration,
          booksRead: 1,
          pagesRead: session.pagesRead,
          dailyStats: [],
        });
      }
    });

    const monthlyStats = Array.from(monthlyStatsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([month, data]) => {
        const fullMonthly = get().getMonthlyStats(year, month);
        return fullMonthly || data;
      });

    return {
      year,
      totalDuration,
      booksRead: uniqueBooks.size,
      pagesRead: totalPages,
      monthlyStats,
    };
  },

  getWordCloudData: (limit: number = 50) => {
    const { stats } = get();
    const wordCountMap: Map<string, number> = new Map();

    // 简单示例：统计书名中出现的词
    stats.sessions.forEach((session) => {
      const words = session.bookTitle.split(/\s+/).filter((word) => word.length > 1);
      words.forEach((word) => {
        const lowerWord = word.toLowerCase();
        wordCountMap.set(lowerWord, (wordCountMap.get(lowerWord) || 0) + 1);
      });
    });

    return Array.from(wordCountMap.entries())
      .map(([word, count]) => ({ word, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);
  },

  clearStats: () => {
    set({
      stats: initialStats,
      currentSession: null,
    });
  },
}));
