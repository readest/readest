import Database from 'better-sqlite3';

import type {
  StatisticsData,
  ReadingSession,
  PageReadingStat,
  BookStatistics,
  DailyReadingSummary,
  UserStatistics,
} from '@/types/statistics';
import {
  CURRENT_STATISTICS_VERSION,
  DEFAULT_STATISTICS_CONFIG,
  DEFAULT_USER_STATISTICS,
} from '@/types/statistics';

// Metadata the caller provides from the library layer
export interface BookMetadata {
  title: string;
  authors: string;
  md5: string; // KOReader-compatible hash
  series?: string;
  language?: string;
  pages?: number;
}

// KOReader DDL for the book table
const CREATE_BOOK_TABLE = `
  CREATE TABLE IF NOT EXISTS book (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    authors TEXT,
    notes INTEGER,
    last_open INTEGER,
    highlights INTEGER,
    pages INTEGER,
    series TEXT,
    language TEXT,
    md5 TEXT,
    total_read_time INTEGER,
    total_read_pages INTEGER
  )
`;

// KOReader DDL for the page_stat_data table
const CREATE_PAGE_STAT_DATA_TABLE = `
  CREATE TABLE IF NOT EXISTS page_stat_data (
    id_book INTEGER NOT NULL,
    page INTEGER NOT NULL,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    total_pages INTEGER,
    UNIQUE(id_book, page, start_time)
  )
`;

/**
 * Export Readest StatisticsData to a KOReader-compatible SQLite database.
 * Returns an in-memory better-sqlite3 Database instance.
 */
export function exportToKOReaderDb(
  data: StatisticsData,
  bookMetadata: Map<string, BookMetadata>,
): Database.Database {
  const db = new Database(':memory:');
  db.pragma('journal_mode = WAL');

  db.exec(CREATE_BOOK_TABLE);
  db.exec(CREATE_PAGE_STAT_DATA_TABLE);

  const insertBook = db.prepare(`
    INSERT INTO book (title, authors, notes, last_open, highlights, pages, series, language, md5, total_read_time, total_read_pages)
    VALUES (@title, @authors, @notes, @lastOpen, @highlights, @pages, @series, @language, @md5, @totalReadTime, @totalReadPages)
  `);

  const insertPageStat = db.prepare(`
    INSERT OR IGNORE INTO page_stat_data (id_book, page, start_time, duration, total_pages)
    VALUES (@idBook, @page, @startTime, @duration, @totalPages)
  `);

  // Collect all unique bookHashes from sessions' pageStats
  const bookHashes = new Set<string>();
  for (const session of data.sessions) {
    if (session.pageStats) {
      for (const ps of session.pageStats) {
        bookHashes.add(ps.bookHash);
      }
    }
  }

  // Map bookHash → KOReader book id
  const bookIdMap = new Map<string, number>();

  const insertBooks = db.transaction(() => {
    for (const bookHash of bookHashes) {
      const meta = bookMetadata.get(bookHash);
      const stats = data.bookStats[bookHash];

      const lastOpen = stats ? Math.floor(stats.lastReadAt / 1000) : 0;
      const totalReadTime = stats ? stats.totalReadingTime : 0;
      const totalReadPages = stats ? stats.totalPagesRead : 0;

      const info = insertBook.run({
        title: meta?.title ?? 'Unknown',
        authors: meta?.authors ?? 'Unknown',
        notes: 0,
        lastOpen,
        highlights: 0,
        pages: meta?.pages ?? 0,
        series: meta?.series ?? null,
        language: meta?.language ?? null,
        md5: meta?.md5 ?? bookHash,
        totalReadTime,
        totalReadPages,
      });

      bookIdMap.set(bookHash, Number(info.lastInsertRowid));
    }
  });

  insertBooks();

  // Insert page stats
  const insertPageStats = db.transaction(() => {
    for (const session of data.sessions) {
      if (!session.pageStats) continue;
      for (const ps of session.pageStats) {
        const idBook = bookIdMap.get(ps.bookHash);
        if (idBook === undefined) continue;

        insertPageStat.run({
          idBook,
          page: ps.page,
          startTime: ps.startTime, // already Unix seconds
          duration: ps.duration,
          totalPages: ps.totalPages,
        });
      }
    }
  });

  insertPageStats();

  return db;
}

// Gap threshold for reconstructing sessions from page stats (5 minutes)
const SESSION_GAP_SECONDS = 300;

/**
 * Import a KOReader SQLite database into Readest StatisticsData.
 */
export function importFromKOReaderDb(db: Database.Database): StatisticsData {
  // Read all books
  const books = db.prepare('SELECT * FROM book').all() as Array<{
    id: number;
    title: string;
    authors: string;
    md5: string;
    pages: number;
    total_read_time: number;
    total_read_pages: number;
    last_open: number;
  }>;

  // Map id_book → md5 (used as bookHash)
  const bookIdToHash = new Map<number, string>();
  const bookIdToPages = new Map<number, number>();
  for (const book of books) {
    bookIdToHash.set(book.id, book.md5);
    bookIdToPages.set(book.id, book.pages);
  }

  // Read all page stats ordered by book and time
  const rows = db
    .prepare('SELECT * FROM page_stat_data ORDER BY id_book, start_time')
    .all() as Array<{
    id_book: number;
    page: number;
    start_time: number;
    duration: number;
    total_pages: number;
  }>;

  // Group by id_book
  const statsByBook = new Map<number, typeof rows>();
  for (const row of rows) {
    let arr = statsByBook.get(row.id_book);
    if (!arr) {
      arr = [];
      statsByBook.set(row.id_book, arr);
    }
    arr.push(row);
  }

  const sessions: ReadingSession[] = [];
  const bookStatsMap: Record<string, BookStatistics> = {};
  const dailySummariesMap: Record<string, DailyReadingSummary> = {};
  let sessionCounter = 0;

  for (const [idBook, pageRows] of statsByBook) {
    const bookHash = bookIdToHash.get(idBook);
    if (!bookHash) continue;
    const totalPagesForBook = bookIdToPages.get(idBook) ?? 0;

    // Split page rows into sessions based on time gaps
    const sessionGroups: (typeof rows)[] = [];
    let currentGroup: typeof rows = [];

    for (const row of pageRows) {
      if (
        currentGroup.length > 0 &&
        row.start_time - (currentGroup.at(-1)!.start_time + currentGroup.at(-1)!.duration) >
          SESSION_GAP_SECONDS
      ) {
        sessionGroups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(row);
    }
    if (currentGroup.length > 0) {
      sessionGroups.push(currentGroup);
    }

    // Build sessions
    for (const group of sessionGroups) {
      const firstRow = group[0]!;
      const lastRow = group.at(-1)!;
      const totalDuration = group.reduce((sum, r) => sum + r.duration, 0);
      const pages = new Set(group.map((r) => r.page));
      const startTimeMs = firstRow.start_time * 1000;
      const endTimeMs = (lastRow.start_time + lastRow.duration) * 1000;

      const pageStats: PageReadingStat[] = group.map((r) => ({
        bookHash,
        page: r.page,
        startTime: r.start_time,
        duration: r.duration,
        totalPages: r.total_pages ?? totalPagesForBook,
      }));

      const minPage = Math.min(...group.map((r) => r.page));
      const maxPage = Math.max(...group.map((r) => r.page));

      sessionCounter++;
      const session: ReadingSession = {
        id: `imported-${sessionCounter}`,
        bookHash,
        startTime: startTimeMs,
        endTime: endTimeMs,
        duration: totalDuration,
        startProgress: totalPagesForBook ? (minPage - 1) / totalPagesForBook : 0,
        endProgress: totalPagesForBook ? maxPage / totalPagesForBook : 0,
        startPage: minPage,
        endPage: maxPage,
        pagesRead: pages.size,
        pageStats,
        createdAt: startTimeMs,
        updatedAt: startTimeMs,
      };

      sessions.push(session);

      // Update daily summary
      const date = new Date(startTimeMs).toISOString().slice(0, 10);
      if (!dailySummariesMap[date]) {
        dailySummariesMap[date] = {
          date,
          totalDuration: 0,
          totalPages: 0,
          sessionsCount: 0,
          booksRead: [],
        };
      }
      const daily = dailySummariesMap[date]!;
      daily.totalDuration += totalDuration;
      daily.totalPages += pages.size;
      daily.sessionsCount += 1;
      if (!daily.booksRead.includes(bookHash)) {
        daily.booksRead.push(bookHash);
      }
    }

    // Build book stats from all page rows for this book
    const allPages = new Set(pageRows.map((r) => r.page));
    const totalReadingTime = pageRows.reduce((sum, r) => sum + r.duration, 0);
    const bookSessions = sessions.filter((s) => s.bookHash === bookHash);
    const firstRead = pageRows[0]!.start_time * 1000;
    const lastRead = pageRows.at(-1)!.start_time * 1000;
    const avgSessionDuration = bookSessions.length > 0 ? totalReadingTime / bookSessions.length : 0;
    const readingHours = totalReadingTime / 3600;
    const avgSpeed = readingHours > 0 ? allPages.size / readingHours : 0;

    bookStatsMap[bookHash] = {
      bookHash,
      totalReadingTime,
      totalSessions: bookSessions.length,
      totalPagesRead: allPages.size,
      averageSessionDuration: avgSessionDuration,
      averageReadingSpeed: avgSpeed,
      firstReadAt: firstRead,
      lastReadAt: lastRead,
    };
  }

  // Build user stats
  const userStats: UserStatistics = {
    ...DEFAULT_USER_STATISTICS,
    readingByHour: new Array(24).fill(0),
    readingByDayOfWeek: new Array(7).fill(0),
  };
  const allBookHashes = Object.keys(bookStatsMap);
  userStats.totalBooksStarted = allBookHashes.length;
  userStats.totalSessions = sessions.length;
  userStats.totalReadingTime = Object.values(bookStatsMap).reduce(
    (sum, b) => sum + b.totalReadingTime,
    0,
  );
  userStats.totalPagesRead = Object.values(bookStatsMap).reduce(
    (sum, b) => sum + b.totalPagesRead,
    0,
  );
  if (sessions.length > 0) {
    userStats.averageSessionDuration = userStats.totalReadingTime / sessions.length;
  }
  const dailyDates = Object.keys(dailySummariesMap);
  if (dailyDates.length > 0) {
    userStats.averageDailyReadingTime = userStats.totalReadingTime / dailyDates.length;
    userStats.lastReadDate = dailyDates.sort().at(-1)!;
  }

  // Compute reading patterns from page stats
  for (const row of rows) {
    const d = new Date(row.start_time * 1000);
    userStats.readingByHour[d.getUTCHours()] =
      (userStats.readingByHour[d.getUTCHours()] ?? 0) + row.duration;
    userStats.readingByDayOfWeek[d.getUTCDay()] =
      (userStats.readingByDayOfWeek[d.getUTCDay()] ?? 0) + row.duration;
  }

  return {
    version: CURRENT_STATISTICS_VERSION,
    sessions,
    dailySummaries: dailySummariesMap,
    bookStats: bookStatsMap,
    userStats,
    config: { ...DEFAULT_STATISTICS_CONFIG },
    lastUpdated: Date.now(),
  };
}
