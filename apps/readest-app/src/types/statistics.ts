// Page-level reading stat - time spent on a specific page (KOReader compatible)
export interface PageReadingStat {
  bookHash: string; // Book identifier
  page: number; // Page number (1-based)
  startTime: number; // When reading started (ms timestamp)
  duration: number; // Seconds spent on this page
  totalPages: number; // Total pages in book at time of recording
}

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

  // Page-level stats for this session (KOReader compatible)
  pageStats?: PageReadingStat[];

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

// Reading goal
export interface ReadingGoal {
  id: string;
  type: 'daily_time' | 'daily_pages' | 'weekly_time' | 'weekly_pages';
  target: number;
  enabled: boolean;
}

// Configuration
export interface StatisticsConfig {
  trackingEnabled: boolean;
  idleTimeoutMinutes: number; // Default: 5
  minimumSessionSeconds: number; // Default: 30
  minimumPageSeconds: number; // Default: 5 (KOReader: min_sec)
  maximumPageSeconds: number; // Default: 120 (KOReader: max_sec)
  goals: ReadingGoal[];
}

// Active page tracking (for page-level stats)
export interface ActivePageState {
  page: number;
  enteredAt: number; // When user entered this page (ms timestamp)
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
  // Page-level tracking
  currentPage: ActivePageState;
  pageStats: PageReadingStat[]; // Accumulated page stats for this session
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
  minimumPageSeconds: 5, // KOReader default: 5 seconds
  maximumPageSeconds: 120, // KOReader default: 120 seconds (2 minutes)
  goals: [],
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
