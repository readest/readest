// 阅读统计相关类型定义

export interface ReadingSession {
  id: string;
  bookHash: string;
  bookTitle: string;
  startTime: number;
  endTime: number;
  duration: number; // 阅读时长（秒）
  pagesRead: number;
  startProgress: number; // 起始进度百分比
  endProgress: number; // 结束进度百分比
}

export interface ReadingStats {
  sessions: ReadingSession[];
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  totalDuration: number; // 总时长（秒）
  booksRead: number; // 阅读的书籍数量
  pagesRead: number;
  sessions: number;
}

export interface MonthlyStats {
  year: number;
  month: number;
  totalDuration: number;
  booksRead: number;
  pagesRead: number;
  dailyStats: DailyStats[];
}

export interface YearlyStats {
  year: number;
  totalDuration: number;
  booksRead: number;
  pagesRead: number;
  monthlyStats: MonthlyStats[];
}

export interface WordCloudItem {
  word: string;
  count: number;
}
