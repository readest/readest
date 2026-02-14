import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';

import {
  exportToKOReaderDb,
  importFromKOReaderDb,
  type BookMetadata,
} from '@/utils/koreaderCompat';
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

// ---------------------------------------------------------------------------
// Fake data generators
// ---------------------------------------------------------------------------

const BOOK_A_HASH = 'abc123hash';
const BOOK_B_HASH = 'def456hash';

/** Base timestamp: 2024-01-15 10:00:00 UTC in seconds */
const BASE_TS = 1705312800;

function createPageStats(
  bookHash: string,
  startPage: number,
  count: number,
  baseTimeSec: number,
  totalPages: number,
): PageReadingStat[] {
  const stats: PageReadingStat[] = [];
  let t = baseTimeSec;
  for (let i = 0; i < count; i++) {
    const duration = 10 + (i % 20); // 10-29 seconds
    stats.push({
      bookHash,
      page: startPage + i,
      startTime: t,
      duration,
      totalPages,
    });
    t += duration;
  }
  return stats;
}

function createFakeStatisticsData(): StatisticsData {
  // Book A: 200 pages, 2 sessions on day 1, 1 session on day 2
  const bookASession1Stats = createPageStats(BOOK_A_HASH, 1, 20, BASE_TS, 200);
  const bookASession2Stats = createPageStats(BOOK_A_HASH, 21, 15, BASE_TS + 7200, 200);
  // Day 2: 2024-01-16 09:00 UTC
  const day2Base = BASE_TS + 86400 - 3600;
  const bookASession3Stats = createPageStats(BOOK_A_HASH, 36, 10, day2Base, 200);

  // Book B: 150 pages, 1 session on day 3
  const day3Base = BASE_TS + 2 * 86400;
  const bookBSession1Stats = createPageStats(BOOK_B_HASH, 1, 25, day3Base, 150);

  const session1: ReadingSession = {
    id: 'session-1',
    bookHash: BOOK_A_HASH,
    startTime: BASE_TS * 1000,
    endTime: (BASE_TS + 600) * 1000,
    duration: 390,
    startProgress: 0,
    endProgress: 0.1,
    startPage: 1,
    endPage: 20,
    pagesRead: 20,
    pageStats: bookASession1Stats,
    createdAt: BASE_TS * 1000,
    updatedAt: BASE_TS * 1000,
  };

  const session2: ReadingSession = {
    id: 'session-2',
    bookHash: BOOK_A_HASH,
    startTime: (BASE_TS + 7200) * 1000,
    endTime: (BASE_TS + 7800) * 1000,
    duration: 300,
    startProgress: 0.1,
    endProgress: 0.175,
    startPage: 21,
    endPage: 35,
    pagesRead: 15,
    pageStats: bookASession2Stats,
    createdAt: (BASE_TS + 7200) * 1000,
    updatedAt: (BASE_TS + 7200) * 1000,
  };

  const session3: ReadingSession = {
    id: 'session-3',
    bookHash: BOOK_A_HASH,
    startTime: day2Base * 1000,
    endTime: (day2Base + 300) * 1000,
    duration: 145,
    startProgress: 0.175,
    endProgress: 0.225,
    startPage: 36,
    endPage: 45,
    pagesRead: 10,
    pageStats: bookASession3Stats,
    createdAt: day2Base * 1000,
    updatedAt: day2Base * 1000,
  };

  const session4: ReadingSession = {
    id: 'session-4',
    bookHash: BOOK_B_HASH,
    startTime: day3Base * 1000,
    endTime: (day3Base + 500) * 1000,
    duration: 460,
    startProgress: 0,
    endProgress: 25 / 150,
    startPage: 1,
    endPage: 25,
    pagesRead: 25,
    pageStats: bookBSession1Stats,
    createdAt: day3Base * 1000,
    updatedAt: day3Base * 1000,
  };

  const sessions = [session1, session2, session3, session4];

  // Compute totals for bookStats
  const allBookAPageStats = [...bookASession1Stats, ...bookASession2Stats, ...bookASession3Stats];
  const bookATime = allBookAPageStats.reduce((s, p) => s + p.duration, 0);

  const bookBTime = bookBSession1Stats.reduce((s, p) => s + p.duration, 0);

  const bookStats: Record<string, BookStatistics> = {
    [BOOK_A_HASH]: {
      bookHash: BOOK_A_HASH,
      totalReadingTime: bookATime,
      totalSessions: 3,
      totalPagesRead: 45,
      averageSessionDuration: bookATime / 3,
      averageReadingSpeed: 45 / (bookATime / 3600),
      firstReadAt: BASE_TS * 1000,
      lastReadAt: day2Base * 1000,
    },
    [BOOK_B_HASH]: {
      bookHash: BOOK_B_HASH,
      totalReadingTime: bookBTime,
      totalSessions: 1,
      totalPagesRead: 25,
      averageSessionDuration: bookBTime,
      averageReadingSpeed: 25 / (bookBTime / 3600),
      firstReadAt: day3Base * 1000,
      lastReadAt: day3Base * 1000,
    },
  };

  const dailySummaries: Record<string, DailyReadingSummary> = {
    '2024-01-15': {
      date: '2024-01-15',
      totalDuration: bookATime - 145,
      totalPages: 35,
      sessionsCount: 2,
      booksRead: [BOOK_A_HASH],
    },
    '2024-01-16': {
      date: '2024-01-16',
      totalDuration: 145,
      totalPages: 10,
      sessionsCount: 1,
      booksRead: [BOOK_A_HASH],
    },
    '2024-01-17': {
      date: '2024-01-17',
      totalDuration: bookBTime,
      totalPages: 25,
      sessionsCount: 1,
      booksRead: [BOOK_B_HASH],
    },
  };

  const userStats: UserStatistics = {
    ...DEFAULT_USER_STATISTICS,
    totalReadingTime: bookATime + bookBTime,
    totalBooksStarted: 2,
    totalBooksCompleted: 0,
    totalPagesRead: 70,
    totalSessions: 4,
    readingByHour: new Array(24).fill(0),
    readingByDayOfWeek: new Array(7).fill(0),
  };

  return {
    version: CURRENT_STATISTICS_VERSION,
    sessions,
    dailySummaries,
    bookStats,
    userStats,
    config: { ...DEFAULT_STATISTICS_CONFIG },
    lastUpdated: Date.now(),
  };
}

function createFakeBookMetadata(): Map<string, BookMetadata> {
  const map = new Map<string, BookMetadata>();
  map.set(BOOK_A_HASH, {
    title: 'Test Book A',
    authors: 'Author A',
    md5: 'md5-aaa-111',
    series: 'Test Series',
    language: 'en',
    pages: 200,
  });
  map.set(BOOK_B_HASH, {
    title: 'Test Book B',
    authors: 'Author B',
    md5: 'md5-bbb-222',
    language: 'fr',
    pages: 150,
  });
  return map;
}

function createFakeKOReaderDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE book (
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
  `);
  db.exec(`
    CREATE TABLE page_stat_data (
      id_book INTEGER NOT NULL,
      page INTEGER NOT NULL,
      start_time INTEGER NOT NULL,
      duration INTEGER NOT NULL,
      total_pages INTEGER,
      UNIQUE(id_book, page, start_time)
    )
  `);

  // Insert 2 books
  db.prepare(
    `INSERT INTO book (title, authors, notes, last_open, highlights, pages, series, language, md5, total_read_time, total_read_pages)
     VALUES (?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?)`,
  ).run('KO Book 1', 'KO Author 1', BASE_TS + 3600, 100, null, 'en', 'ko-md5-1', 500, 30);

  db.prepare(
    `INSERT INTO book (title, authors, notes, last_open, highlights, pages, series, language, md5, total_read_time, total_read_pages)
     VALUES (?, ?, 0, ?, 0, ?, ?, ?, ?, ?, ?)`,
  ).run('KO Book 2', 'KO Author 2', BASE_TS + 86400, 80, 'SciFi', 'de', 'ko-md5-2', 300, 20);

  // Insert page stats for book 1 — two sessions with a gap
  const insertPS = db.prepare(
    'INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (?, ?, ?, ?, ?)',
  );
  // Session 1: 20 pages starting at BASE_TS
  let t = BASE_TS;
  for (let i = 1; i <= 20; i++) {
    const dur = 15;
    insertPS.run(1, i, t, dur, 100);
    t += dur;
  }
  // Session 2: 10 pages starting at BASE_TS + 1800 (30 min gap)
  t = BASE_TS + 1800;
  for (let i = 21; i <= 30; i++) {
    const dur = 20;
    insertPS.run(1, i, t, dur, 100);
    t += dur;
  }

  // Insert page stats for book 2 — single session
  t = BASE_TS + 86400;
  for (let i = 1; i <= 20; i++) {
    const dur = 12;
    insertPS.run(2, i, t, dur, 80);
    t += dur;
  }

  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KOReader Statistics Conversion', () => {
  describe('exportToKOReaderDb', () => {
    it('creates correct book table schema', () => {
      const data = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(data, meta);

      const tableInfo = db.pragma('table_info(book)') as Array<{
        name: string;
        type: string;
      }>;
      const columns = tableInfo.map((c) => c.name);

      expect(columns).toContain('id');
      expect(columns).toContain('title');
      expect(columns).toContain('authors');
      expect(columns).toContain('md5');
      expect(columns).toContain('pages');
      expect(columns).toContain('total_read_time');
      expect(columns).toContain('total_read_pages');
      expect(columns).toContain('last_open');
      expect(columns).toContain('series');
      expect(columns).toContain('language');

      db.close();
    });

    it('creates correct page_stat_data table schema', () => {
      const data = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(data, meta);

      const tableInfo = db.pragma('table_info(page_stat_data)') as Array<{
        name: string;
        type: string;
      }>;
      const columns = tableInfo.map((c) => c.name);

      expect(columns).toContain('id_book');
      expect(columns).toContain('page');
      expect(columns).toContain('start_time');
      expect(columns).toContain('duration');
      expect(columns).toContain('total_pages');

      db.close();
    });

    it('maps book metadata to book table rows', () => {
      const data = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(data, meta);

      const books = db.prepare('SELECT * FROM book ORDER BY id').all() as Array<{
        id: number;
        title: string;
        authors: string;
        md5: string;
        pages: number;
        series: string | null;
        language: string | null;
      }>;

      expect(books).toHaveLength(2);

      const bookA = books.find((b) => b.md5 === 'md5-aaa-111');
      expect(bookA).toBeDefined();
      expect(bookA!.title).toBe('Test Book A');
      expect(bookA!.authors).toBe('Author A');
      expect(bookA!.pages).toBe(200);
      expect(bookA!.series).toBe('Test Series');
      expect(bookA!.language).toBe('en');

      const bookB = books.find((b) => b.md5 === 'md5-bbb-222');
      expect(bookB).toBeDefined();
      expect(bookB!.title).toBe('Test Book B');
      expect(bookB!.authors).toBe('Author B');
      expect(bookB!.pages).toBe(150);
      expect(bookB!.language).toBe('fr');

      db.close();
    });

    it('maps PageReadingStat to page_stat_data rows with correct fields', () => {
      const data = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(data, meta);

      const rows = db
        .prepare('SELECT * FROM page_stat_data ORDER BY id_book, start_time')
        .all() as Array<{
        id_book: number;
        page: number;
        start_time: number;
        duration: number;
        total_pages: number;
      }>;

      // Total page stats: 20 + 15 + 10 (book A) + 25 (book B) = 70
      expect(rows).toHaveLength(70);

      // Check first row matches first page stat of session 1
      const firstRow = rows[0]!;
      expect(firstRow.page).toBe(1);
      expect(firstRow.start_time).toBe(BASE_TS);
      expect(firstRow.duration).toBe(10); // 10 + (0 % 20) = 10

      db.close();
    });

    it('stores startTime as Unix seconds (not ms)', () => {
      const data = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(data, meta);

      const row = db.prepare('SELECT start_time FROM page_stat_data LIMIT 1').get() as {
        start_time: number;
      };

      // Should be seconds (roughly ~1.7 billion), not ms (~1.7 trillion)
      expect(row.start_time).toBeLessThan(10_000_000_000);
      expect(row.start_time).toBeGreaterThan(1_000_000_000);

      db.close();
    });

    it('populates total_read_time and total_read_pages from bookStats', () => {
      const data = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(data, meta);

      const books = db.prepare('SELECT * FROM book').all() as Array<{
        md5: string;
        total_read_time: number;
        total_read_pages: number;
      }>;

      const bookA = books.find((b) => b.md5 === 'md5-aaa-111')!;
      expect(bookA.total_read_time).toBe(data.bookStats[BOOK_A_HASH]!.totalReadingTime);
      expect(bookA.total_read_pages).toBe(data.bookStats[BOOK_A_HASH]!.totalPagesRead);

      const bookB = books.find((b) => b.md5 === 'md5-bbb-222')!;
      expect(bookB.total_read_time).toBe(data.bookStats[BOOK_B_HASH]!.totalReadingTime);
      expect(bookB.total_read_pages).toBe(data.bookStats[BOOK_B_HASH]!.totalPagesRead);

      db.close();
    });

    it('handles multiple books', () => {
      const data = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(data, meta);

      const bookCount = (
        db.prepare('SELECT COUNT(*) as count FROM book').get() as { count: number }
      ).count;
      expect(bookCount).toBe(2);

      // Each book should have its own id_book in page_stat_data
      const distinctBooks = db
        .prepare('SELECT DISTINCT id_book FROM page_stat_data')
        .all() as Array<{ id_book: number }>;
      expect(distinctBooks).toHaveLength(2);

      db.close();
    });

    it('deduplicates page stats on export (INSERT OR IGNORE)', () => {
      const data = createFakeStatisticsData();
      // Duplicate the first session's page stats into a second session
      const dupSession: ReadingSession = {
        ...data.sessions[0]!,
        id: 'dup-session',
        pageStats: [...data.sessions[0]!.pageStats!],
      };
      data.sessions.push(dupSession);

      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(data, meta);

      // Should still have 70 unique page stats (not 90)
      const count = (
        db.prepare('SELECT COUNT(*) as count FROM page_stat_data').get() as { count: number }
      ).count;
      expect(count).toBe(70);

      db.close();
    });
  });

  describe('importFromKOReaderDb', () => {
    it('reads book table and maps id_book to md5', () => {
      const db = createFakeKOReaderDb();
      const result = importFromKOReaderDb(db);

      // Should have stats for both books keyed by md5
      expect(Object.keys(result.bookStats)).toContain('ko-md5-1');
      expect(Object.keys(result.bookStats)).toContain('ko-md5-2');

      db.close();
    });

    it('reads page_stat_data and creates PageReadingStat entries', () => {
      const db = createFakeKOReaderDb();
      const result = importFromKOReaderDb(db);

      // All sessions should contain page stats
      const allPageStats = result.sessions.flatMap((s) => s.pageStats ?? []);
      // book 1: 30 rows, book 2: 20 rows
      expect(allPageStats).toHaveLength(50);

      // Verify each page stat has the expected fields
      for (const ps of allPageStats) {
        expect(ps.bookHash).toBeDefined();
        expect(ps.page).toBeGreaterThanOrEqual(1);
        expect(ps.startTime).toBeGreaterThan(0);
        expect(ps.duration).toBeGreaterThan(0);
        expect(ps.totalPages).toBeGreaterThan(0);
      }

      db.close();
    });

    it('reconstructs sessions from time gaps', () => {
      const db = createFakeKOReaderDb();
      const result = importFromKOReaderDb(db);

      // Book 1 has a 30-minute gap → 2 sessions
      // Book 2 has 1 contiguous session
      // Total: 3 sessions
      expect(result.sessions).toHaveLength(3);

      const book1Sessions = result.sessions.filter((s) => s.bookHash === 'ko-md5-1');
      expect(book1Sessions).toHaveLength(2);
      expect(book1Sessions[0]!.pagesRead).toBe(20);
      expect(book1Sessions[1]!.pagesRead).toBe(10);

      const book2Sessions = result.sessions.filter((s) => s.bookHash === 'ko-md5-2');
      expect(book2Sessions).toHaveLength(1);
      expect(book2Sessions[0]!.pagesRead).toBe(20);

      db.close();
    });

    it('estimates progress from page/totalPages', () => {
      const db = createFakeKOReaderDb();
      const result = importFromKOReaderDb(db);

      const book1Session1 = result.sessions.find(
        (s) => s.bookHash === 'ko-md5-1' && s.startPage === 1,
      )!;
      // Pages 1-20 out of 100
      expect(book1Session1.startProgress).toBeCloseTo(0, 2);
      expect(book1Session1.endProgress).toBeCloseTo(0.2, 2);

      db.close();
    });

    it('recomputes bookStats from page data', () => {
      const db = createFakeKOReaderDb();
      const result = importFromKOReaderDb(db);

      const stats1 = result.bookStats['ko-md5-1']!;
      expect(stats1.totalReadingTime).toBe(20 * 15 + 10 * 20); // 500
      expect(stats1.totalPagesRead).toBe(30);
      expect(stats1.totalSessions).toBe(2);
      expect(stats1.averageSessionDuration).toBe(500 / 2);

      const stats2 = result.bookStats['ko-md5-2']!;
      expect(stats2.totalReadingTime).toBe(20 * 12); // 240
      expect(stats2.totalPagesRead).toBe(20);
      expect(stats2.totalSessions).toBe(1);

      db.close();
    });

    it('recomputes dailySummaries', () => {
      const db = createFakeKOReaderDb();
      const result = importFromKOReaderDb(db);

      const dates = Object.keys(result.dailySummaries).sort();
      expect(dates.length).toBeGreaterThanOrEqual(1);

      // Every daily summary should have positive values
      for (const date of dates) {
        const summary = result.dailySummaries[date]!;
        expect(summary.totalDuration).toBeGreaterThan(0);
        expect(summary.totalPages).toBeGreaterThan(0);
        expect(summary.sessionsCount).toBeGreaterThan(0);
        expect(summary.booksRead.length).toBeGreaterThan(0);
      }

      db.close();
    });

    it('handles empty database', () => {
      const db = new Database(':memory:');
      db.exec(`
        CREATE TABLE book (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT, authors TEXT, notes INTEGER, last_open INTEGER,
          highlights INTEGER, pages INTEGER, series TEXT, language TEXT,
          md5 TEXT, total_read_time INTEGER, total_read_pages INTEGER
        )
      `);
      db.exec(`
        CREATE TABLE page_stat_data (
          id_book INTEGER NOT NULL, page INTEGER NOT NULL,
          start_time INTEGER NOT NULL, duration INTEGER NOT NULL,
          total_pages INTEGER, UNIQUE(id_book, page, start_time)
        )
      `);

      const result = importFromKOReaderDb(db);

      expect(result.sessions).toHaveLength(0);
      expect(Object.keys(result.bookStats)).toHaveLength(0);
      expect(Object.keys(result.dailySummaries)).toHaveLength(0);
      expect(result.version).toBe(CURRENT_STATISTICS_VERSION);

      db.close();
    });
  });

  describe('round-trip', () => {
    it('export → import preserves all page-level data', () => {
      const original = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(original, meta);
      const imported = importFromKOReaderDb(db);

      // Collect all original page stats
      const originalPageStats = original.sessions
        .flatMap((s) => s.pageStats ?? [])
        .sort((a, b) => a.startTime - b.startTime || a.page - b.page);

      // Collect all imported page stats
      const importedPageStats = imported.sessions
        .flatMap((s) => s.pageStats ?? [])
        .sort((a, b) => a.startTime - b.startTime || a.page - b.page);

      expect(importedPageStats).toHaveLength(originalPageStats.length);

      for (let i = 0; i < originalPageStats.length; i++) {
        const orig = originalPageStats[i]!;
        const imp = importedPageStats[i]!;

        expect(imp.page).toBe(orig.page);
        expect(imp.startTime).toBe(orig.startTime);
        expect(imp.duration).toBe(orig.duration);
        expect(imp.totalPages).toBe(orig.totalPages);
      }

      db.close();
    });

    it('export → import preserves book statistics aggregates', () => {
      const original = createFakeStatisticsData();
      const meta = createFakeBookMetadata();
      const db = exportToKOReaderDb(original, meta);
      const imported = importFromKOReaderDb(db);

      // md5 is used as bookHash in import, so look up via metadata mapping
      for (const [bookHash, origStats] of Object.entries(original.bookStats)) {
        const bookMeta = meta.get(bookHash)!;
        const impStats = imported.bookStats[bookMeta.md5]!;

        expect(impStats).toBeDefined();
        expect(impStats.totalReadingTime).toBe(origStats.totalReadingTime);
        expect(impStats.totalPagesRead).toBe(origStats.totalPagesRead);
      }

      db.close();
    });

    it('import → export preserves page_stat_data rows exactly', () => {
      const originalDb = createFakeKOReaderDb();

      // Import
      const data = importFromKOReaderDb(originalDb);

      // Build metadata map from the original DB's book table
      const books = originalDb.prepare('SELECT * FROM book').all() as Array<{
        md5: string;
        title: string;
        authors: string;
        pages: number;
      }>;
      const meta = new Map<string, BookMetadata>();
      for (const b of books) {
        meta.set(b.md5, {
          title: b.title,
          authors: b.authors,
          md5: b.md5,
          pages: b.pages,
        });
      }

      // Re-export
      const reExportedDb = exportToKOReaderDb(data, meta);

      // Compare page_stat_data rows
      const originalRows = originalDb
        .prepare(
          `SELECT b.md5, p.page, p.start_time, p.duration, p.total_pages
           FROM page_stat_data p JOIN book b ON p.id_book = b.id
           ORDER BY b.md5, p.start_time, p.page`,
        )
        .all() as Array<{
        md5: string;
        page: number;
        start_time: number;
        duration: number;
        total_pages: number;
      }>;

      const reExportedRows = reExportedDb
        .prepare(
          `SELECT b.md5, p.page, p.start_time, p.duration, p.total_pages
           FROM page_stat_data p JOIN book b ON p.id_book = b.id
           ORDER BY b.md5, p.start_time, p.page`,
        )
        .all() as Array<{
        md5: string;
        page: number;
        start_time: number;
        duration: number;
        total_pages: number;
      }>;

      expect(reExportedRows).toHaveLength(originalRows.length);

      for (let i = 0; i < originalRows.length; i++) {
        expect(reExportedRows[i]!.md5).toBe(originalRows[i]!.md5);
        expect(reExportedRows[i]!.page).toBe(originalRows[i]!.page);
        expect(reExportedRows[i]!.start_time).toBe(originalRows[i]!.start_time);
        expect(reExportedRows[i]!.duration).toBe(originalRows[i]!.duration);
        expect(reExportedRows[i]!.total_pages).toBe(originalRows[i]!.total_pages);
      }

      originalDb.close();
      reExportedDb.close();
    });
  });

  describe('inspect data (debug)', () => {
    it('logs full export → import pipeline', () => {
      const data = createFakeStatisticsData();
      const meta = createFakeBookMetadata();

      console.log('\n=== INPUT: StatisticsData (sessions summary) ===');
      for (const s of data.sessions) {
        console.log(
          `  Session ${s.id}: book=${s.bookHash.slice(0, 8)}… pages=${s.startPage}-${s.endPage} pageStats=${s.pageStats?.length ?? 0}`,
        );
      }
      console.log('\n=== INPUT: bookStats ===');
      for (const [hash, bs] of Object.entries(data.bookStats)) {
        console.log(
          `  ${hash.slice(0, 8)}…: readTime=${bs.totalReadingTime}s sessions=${bs.totalSessions} pages=${bs.totalPagesRead}`,
        );
      }
      console.log('\n=== INPUT: BookMetadata ===');
      for (const [hash, m] of meta) {
        console.log(`  ${hash.slice(0, 8)}… → title="${m.title}" md5=${m.md5} pages=${m.pages}`);
      }

      // Export
      const db = exportToKOReaderDb(data, meta);

      const books = db.prepare('SELECT * FROM book ORDER BY id').all();
      const pageStats = db
        .prepare('SELECT * FROM page_stat_data ORDER BY id_book, start_time')
        .all() as Array<{
        id_book: number;
        page: number;
        start_time: number;
        duration: number;
        total_pages: number;
      }>;

      console.log('\n=== EXPORTED: book table ===');
      console.table(books);
      console.log(`\n=== EXPORTED: page_stat_data (${pageStats.length} rows, first 15) ===`);
      console.table(pageStats.slice(0, 15));
      console.log(`  ... and ${Math.max(0, pageStats.length - 15)} more rows`);

      // Import back
      const imported = importFromKOReaderDb(db);

      console.log('\n=== IMPORTED: sessions ===');
      for (const s of imported.sessions) {
        console.log(
          `  Session ${s.id}: book=${s.bookHash.slice(0, 8)}… pages=${s.startPage}-${s.endPage} duration=${s.duration}s pageStats=${s.pageStats?.length ?? 0}`,
        );
      }
      console.log('\n=== IMPORTED: bookStats ===');
      for (const [hash, bs] of Object.entries(imported.bookStats)) {
        console.log(
          `  ${hash.slice(0, 8)}…: readTime=${bs.totalReadingTime}s sessions=${bs.totalSessions} pages=${bs.totalPagesRead}`,
        );
      }
      console.log('\n=== IMPORTED: dailySummaries ===');
      for (const [date, ds] of Object.entries(imported.dailySummaries)) {
        console.log(
          `  ${date}: duration=${ds.totalDuration}s pages=${ds.totalPages} sessions=${ds.sessionsCount} books=[${ds.booksRead.map((b) => b.slice(0, 8)).join(', ')}]`,
        );
      }
      console.log('\n=== IMPORTED: userStats ===');
      console.log(
        `  totalReadingTime=${imported.userStats.totalReadingTime}s books=${imported.userStats.totalBooksStarted} sessions=${imported.userStats.totalSessions} pages=${imported.userStats.totalPagesRead}`,
      );

      db.close();
      expect(true).toBe(true);
    });
  });
});
