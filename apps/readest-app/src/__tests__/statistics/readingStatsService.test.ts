import { describe, it, expect, beforeEach } from 'vitest';
import { NodeDatabaseService } from '@/services/database/nodeDatabaseService';
import { migrate } from '@/services/database/migrate';
import { getMigrations } from '@/services/database/migrations';
import type { DatabaseService } from '@/types/database';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { ReadingStatsService } from '@/services/statistics/readingStatsService';

// ── Helpers ──────────────────────────────────────────────────────────

async function freshStatsDb(): Promise<{ db: DatabaseService; stats: StatisticsDb }> {
  const db = await NodeDatabaseService.open(':memory:');
  await migrate(db, getMigrations('statistics'));
  const stats = StatisticsDb.from(db);
  return { db, stats };
}

/** Insert a book and return its id_book. */
async function insertBook(db: DatabaseService, md5: string, title = 'Book'): Promise<number> {
  await db.execute(
    `INSERT OR IGNORE INTO book (title, authors, md5, total_read_time, total_read_pages, last_open, pages) VALUES (?, '', ?, 0, 0, 0, 0)`,
    [title, md5],
  );
  const rows = await db.select<{ id: number }>(`SELECT id FROM book WHERE md5 = ? LIMIT 1`, [md5]);
  return rows[0]!.id;
}

/** Insert a page stat event. startTime is Unix seconds. */
async function insertEvent(
  db: DatabaseService,
  idBook: number,
  page: number,
  startTime: number,
  duration: number,
  totalPages = 100,
): Promise<void> {
  await db.execute(
    `INSERT INTO page_stat_data (id_book, page, start_time, duration, total_pages) VALUES (?, ?, ?, ?, ?)`,
    [idBook, page, startTime, duration, totalPages],
  );
}

/**
 * Convert a 'YYYY-MM-DD' date to a Unix timestamp at noon local time.
 * Using noon avoids DST edge cases.
 */
function dateToUnix(dateStr: string): number {
  return Math.floor(new Date(`${dateStr}T12:00:00`).getTime() / 1000);
}

/** Today as 'YYYY-MM-DD'. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** N days ago as 'YYYY-MM-DD'. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Unix timestamp for today's local midnight (00:00:00).
 * Using midnight guarantees the timestamp is always within today and always
 * ≤ nowUnix, even when a test runs in the first seconds after midnight.
 */
function todayMidnightUnix(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

// ── Tests ────────────────────────────────────────────────────────────

describe('ReadingStatsService', () => {
  let db: DatabaseService;
  let stats: StatisticsDb;
  let service: ReadingStatsService;

  beforeEach(async () => {
    const fresh = await freshStatsDb();
    db = fresh.db;
    stats = fresh.stats;
    service = new ReadingStatsService(stats);
  });

  // ── getDailyReadingMap ─────────────────────────────────────────────

  describe('getDailyReadingMap', () => {
    it('returns empty array with no data', async () => {
      const result = await service.getDailyReadingMap('2026-01-01', '2026-12-31');
      expect(result).toEqual([]);
    });

    it('aggregates reading time by day', async () => {
      const bookId = await insertBook(db, 'book1');
      const day = '2026-06-15';
      const ts = dateToUnix(day);

      // Two reading events on the same day
      await insertEvent(db, bookId, 1, ts, 120);
      await insertEvent(db, bookId, 2, ts + 200, 180);

      const result = await service.getDailyReadingMap('2026-06-01', '2026-06-30');
      expect(result.length).toBe(1);
      expect(result[0]!.date).toBe(day);
      expect(result[0]!.totalSeconds).toBe(300); // 120 + 180
      expect(result[0]!.bookCount).toBe(1);
    });

    it('counts distinct books per day', async () => {
      const book1 = await insertBook(db, 'book1', 'Book 1');
      const book2 = await insertBook(db, 'book2', 'Book 2');
      const day = '2026-06-15';
      const ts = dateToUnix(day);

      await insertEvent(db, book1, 1, ts, 60);
      await insertEvent(db, book2, 1, ts + 100, 60);

      const result = await service.getDailyReadingMap('2026-06-01', '2026-06-30');
      expect(result.length).toBe(1);
      expect(result[0]!.bookCount).toBe(2);
    });

    it('returns multiple days sorted', async () => {
      const bookId = await insertBook(db, 'book1');
      const day1 = '2026-06-10';
      const day2 = '2026-06-15';

      await insertEvent(db, bookId, 1, dateToUnix(day1), 60);
      await insertEvent(db, bookId, 2, dateToUnix(day2), 120);

      const result = await service.getDailyReadingMap('2026-06-01', '2026-06-30');
      expect(result.length).toBe(2);
      expect(result[0]!.date).toBe(day1);
      expect(result[1]!.date).toBe(day2);
    });
  });

  // ── getStreakInfo ──────────────────────────────────────────────────

  describe('getStreakInfo', () => {
    it('returns zeros with no data', async () => {
      const result = await service.getStreakInfo();
      expect(result.currentStreak).toBe(0);
      expect(result.longestStreak).toBe(0);
      expect(result.currentStreakStart).toBeNull();
    });

    it('counts a current streak of consecutive days ending today', async () => {
      const bookId = await insertBook(db, 'book1');
      const today = todayISO();
      const yesterday = daysAgo(1);
      const twoDaysAgo = daysAgo(2);

      // 3 consecutive days of reading, each with >= 60 seconds
      await insertEvent(db, bookId, 1, dateToUnix(twoDaysAgo), 120);
      await insertEvent(db, bookId, 2, dateToUnix(yesterday), 120);
      await insertEvent(db, bookId, 3, dateToUnix(today), 120);

      const result = await service.getStreakInfo();
      expect(result.currentStreak).toBe(3);
      expect(result.currentStreakStart).toBe(twoDaysAgo);
    });

    it('counts current streak ending yesterday (not broken yet)', async () => {
      const bookId = await insertBook(db, 'book1');
      const yesterday = daysAgo(1);
      const twoDaysAgo = daysAgo(2);

      await insertEvent(db, bookId, 1, dateToUnix(twoDaysAgo), 120);
      await insertEvent(db, bookId, 2, dateToUnix(yesterday), 120);

      const result = await service.getStreakInfo();
      expect(result.currentStreak).toBe(2);
    });

    it('reports zero current streak if last reading was 2+ days ago', async () => {
      const bookId = await insertBook(db, 'book1');
      const threeDaysAgo = daysAgo(3);

      await insertEvent(db, bookId, 1, dateToUnix(threeDaysAgo), 120);

      const result = await service.getStreakInfo();
      expect(result.currentStreak).toBe(0);
    });

    it('does not count days with less than 60 seconds of reading', async () => {
      const bookId = await insertBook(db, 'book1');
      const today = todayISO();
      const yesterday = daysAgo(1);

      // Today: sufficient reading
      await insertEvent(db, bookId, 1, dateToUnix(today), 120);
      // Yesterday: only 30 seconds (below threshold)
      await insertEvent(db, bookId, 2, dateToUnix(yesterday), 30);

      const result = await service.getStreakInfo();
      expect(result.currentStreak).toBe(1); // only today counts
    });

    it('finds the longest streak across all history', async () => {
      const bookId = await insertBook(db, 'book1');

      // A 5-day streak in the past
      for (let i = 0; i < 5; i++) {
        await insertEvent(db, bookId, i + 1, dateToUnix(daysAgo(20 - i)), 120);
      }

      // A 2-day current streak
      await insertEvent(db, bookId, 10, dateToUnix(daysAgo(1)), 120);
      await insertEvent(db, bookId, 11, dateToUnix(todayISO()), 120);

      const result = await service.getStreakInfo();
      expect(result.currentStreak).toBe(2);
      expect(result.longestStreak).toBe(5);
    });

    it('handles a single day of reading', async () => {
      const bookId = await insertBook(db, 'book1');
      await insertEvent(db, bookId, 1, dateToUnix(todayISO()), 120);

      const result = await service.getStreakInfo();
      expect(result.currentStreak).toBe(1);
      expect(result.longestStreak).toBe(1);
    });
  });

  // ── getOverallStats ───────────────────────────────────────────────

  describe('getOverallStats', () => {
    it('returns zeros with no data', async () => {
      const result = await service.getOverallStats();
      expect(result.totalSeconds).toBe(0);
      expect(result.todaySeconds).toBe(0);
      expect(result.weekSeconds).toBe(0);
      expect(result.monthSeconds).toBe(0);
      expect(result.booksRead).toBe(0);
      expect(result.totalPages).toBe(0);
    });

    it('sums total reading time correctly', async () => {
      const bookId = await insertBook(db, 'book1');
      await insertEvent(db, bookId, 1, dateToUnix(daysAgo(30)), 600);
      await insertEvent(db, bookId, 2, dateToUnix(daysAgo(10)), 300);
      await insertEvent(db, bookId, 3, dateToUnix(todayISO()), 200);

      const result = await service.getOverallStats();
      expect(result.totalSeconds).toBe(1100);
    });

    it('counts today reading time', async () => {
      const bookId = await insertBook(db, 'book1');
      await insertEvent(db, bookId, 1, todayMidnightUnix(), 500);
      await insertEvent(db, bookId, 2, dateToUnix(daysAgo(5)), 300);

      const result = await service.getOverallStats();
      expect(result.todaySeconds).toBe(500);
    });

    it('counts distinct books', async () => {
      const book1 = await insertBook(db, 'book1', 'Book 1');
      const book2 = await insertBook(db, 'book2', 'Book 2');

      await insertEvent(db, book1, 1, dateToUnix(todayISO()), 60);
      await insertEvent(db, book2, 1, dateToUnix(todayISO()) + 100, 60);

      const result = await service.getOverallStats();
      expect(result.booksRead).toBe(2);
    });

    it('counts distinct pages', async () => {
      const bookId = await insertBook(db, 'book1');
      // Same book, different pages
      await insertEvent(db, bookId, 1, dateToUnix(todayISO()), 60);
      await insertEvent(db, bookId, 2, dateToUnix(todayISO()) + 100, 60);
      await insertEvent(db, bookId, 3, dateToUnix(todayISO()) + 200, 60);

      const result = await service.getOverallStats();
      expect(result.totalPages).toBe(3);
    });
  });
});
