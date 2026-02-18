// Reading session - individual reading period for a book
export interface ReadingSession {
  id: string; // UUID
  bookHash: string; // Book identifier
  metaHash?: string; // For aggregating book versions

  startTime: number; // Session start (ms timestamp)
  endTime: number; // Session end (ms timestamp)
  duration: number; // Duration in seconds

  startProgress: number; // Progress at start (0-1)
  endProgress: number; // Progress at end (0-1)
  startPage: number; // Page at start
  endPage: number; // Page at end
  pagesRead: number; // Pages read in session

  createdAt: number;
  updatedAt: number;
}

// Daily reading summary
export interface DailyReadingSummary {
  date: string; // YYYY-MM-DD
  totalDuration: number; // Seconds read
  totalPages: number;
  sessionsCount: number;
  booksRead: string[]; // Book hashes
}

// Book-specific statistics
export interface BookStatistics {
  bookHash: string;
  metaHash?: string;
  totalReadingTime: number; // Seconds
  totalSessions: number;
  totalPagesRead: number;
  averageSessionDuration: number;
  averageReadingSpeed: number; // Pages per hour
  firstReadAt: number;
  lastReadAt: number;
  completedAt?: number;
}

// User statistics
export interface UserStatistics {
  totalReadingTime: number;
  totalBooksStarted: number;
  totalBooksCompleted: number;
  totalPagesRead: number;
  totalSessions: number;

  currentStreak: number; // Consecutive days
  longestStreak: number;
  lastReadDate: string; // YYYY-MM-DD

  averageSessionDuration: number;
  averageDailyReadingTime: number;

  readingByHour: number[]; // 24 elements (0-23)
  readingByDayOfWeek: number[]; // 7 elements (0=Sunday)
}

// Configuration
export interface StatisticsConfig {
  trackingEnabled: boolean;
  idleTimeoutMinutes: number; // Default: 5
  minimumSessionSeconds: number; // Default: 30
}

// Active session tracking (not persisted)
export interface ActiveSession {
  bookKey: string;
  bookHash: string;
  metaHash?: string;
  startTime: number;
  startProgress: number;
  startPage: number;
  lastActivityTime: number;
  lastProgress: number;
  lastPage: number;
  totalPages: number;
}

// Storage format
export interface StatisticsData {
  version: number;
  sessions: ReadingSession[];
  dailySummaries: Record<string, DailyReadingSummary>;
  bookStats: Record<string, BookStatistics>;
  userStats: UserStatistics;
  config: StatisticsConfig;
  lastUpdated: number;
}

// Default values
export const DEFAULT_STATISTICS_CONFIG: StatisticsConfig = {
  trackingEnabled: true,
  idleTimeoutMinutes: 5,
  minimumSessionSeconds: 30,
};

export const DEFAULT_USER_STATISTICS: UserStatistics = {
  totalReadingTime: 0,
  totalBooksStarted: 0,
  totalBooksCompleted: 0,
  totalPagesRead: 0,
  totalSessions: 0,
  currentStreak: 0,
  longestStreak: 0,
  lastReadDate: '',
  averageSessionDuration: 0,
  averageDailyReadingTime: 0,
  readingByHour: new Array(24).fill(0),
  readingByDayOfWeek: new Array(7).fill(0),
};

export const CURRENT_STATISTICS_VERSION = 1;

export const DEFAULT_STATISTICS_DATA: StatisticsData = {
  version: CURRENT_STATISTICS_VERSION,
  sessions: [],
  dailySummaries: {},
  bookStats: {},
  userStats: DEFAULT_USER_STATISTICS,
  config: DEFAULT_STATISTICS_CONFIG,
  lastUpdated: Date.now(),
};
