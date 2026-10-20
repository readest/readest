import type { StatisticsDb } from './statisticsDb';
import type { DatabaseRow } from '@/types/database';

// ── Public types ──────────────────────────────────────────────────────

/** Reading time aggregated for a single calendar day. */
export interface DailyReading {
  /** ISO date string, e.g. "2026-10-15" */
  date: string;
  /** Total seconds spent reading that day. */
  totalSeconds: number;
  /** Distinct books read that day. */
  bookCount: number;
}

/** Current and all-time streak information. */
export interface StreakInfo {
  /** Consecutive days ending today or yesterday with ≥ 1 min reading. */
  currentStreak: number;
  /** Longest-ever run of consecutive reading days. */
  longestStreak: number;
  /** ISO date the current streak started, or null if no streak. */
  currentStreakStart: string | null;
}

/** Aggregate reading statistics at various time windows. */
export interface OverallStats {
  /** Total reading time ever (seconds). */
  totalSeconds: number;
  /** Reading time today (seconds). */
  todaySeconds: number;
  /** Reading time this calendar week Mon–Sun (seconds). */
  weekSeconds: number;
  /** Reading time this calendar month (seconds). */
  monthSeconds: number;
  /** Distinct books with any reading time. */
  booksRead: number;
  /** Total distinct pages read (all books). */
  totalPages: number;
}

// ── Minimum seconds in a day to count as "read" for streak purposes ───
const MIN_STREAK_SECONDS = 60; // 1 minute

// ── Helpers ───────────────────────────────────────────────────────────

/** Today as 'YYYY-MM-DD' in local time. */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** First day of current ISO week (Monday) as 'YYYY-MM-DD'. */
function weekStartISO(): string {
  const d = new Date();
  const day = d.getDay(); // 0=Sun … 6=Sat
  const diff = day === 0 ? 6 : day - 1; // days since Monday
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** First day of current month as 'YYYY-MM-DD'. */
function monthStartISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

// ── Service ───────────────────────────────────────────────────────────

/**
 * Read-only query layer over `StatisticsDb` for streak / heatmap / summary
 * data. All computation is SQL-based against the existing `page_stat_data`
 * and `book` tables — no new tables or columns required.
 *
 * Every method accepts the shared `StatisticsDb` instance so it doesn't
 * open a second OPFS connection.
 */
export class ReadingStatsService {
  constructor(private readonly stats: StatisticsDb) {}

  // ── Daily reading map (powers the heatmap) ─────────────────────────

  /**
   * Aggregate reading by calendar day for a date range.
   *
   * @param startDate  Inclusive start, 'YYYY-MM-DD' (local time).
   * @param endDate    Inclusive end, 'YYYY-MM-DD' (local time).
   */
  async getDailyReadingMap(startDate: string, endDate: string): Promise<DailyReading[]> {
    const startUnix = Math.floor(new Date(`${startDate}T00:00:00`).getTime() / 1000);
    const endUnix = Math.floor(new Date(`${endDate}T23:59:59`).getTime() / 1000);

    const rows = await this.db.select<DatabaseRow>(
      `SELECT
         date(start_time, 'unixepoch', 'localtime') AS day,
         SUM(duration) AS total_seconds,
         COUNT(DISTINCT id_book) AS book_count
       FROM page_stat_data
       WHERE start_time >= ? AND start_time <= ?
       GROUP BY day
       ORDER BY day ASC`,
      [startUnix, endUnix],
    );

    return rows.map((r) => ({
      date: String(r['day']),
      totalSeconds: Number(r['total_seconds']),
      bookCount: Number(r['book_count']),
    }));
  }

  // ── Streak computation ─────────────────────────────────────────────

  /**
   * Compute current and longest reading streaks.
   *
   * A "reading day" is a calendar day with ≥ MIN_STREAK_SECONDS of reading.
   * Current streak: consecutive days ending today OR yesterday (so the
   * streak isn't broken at 00:01 before you've read today).
   */
  async getStreakInfo(): Promise<StreakInfo> {
    // Get all distinct days with enough reading, ordered descending.
    const rows = await this.db.select<DatabaseRow>(
      `SELECT date(start_time, 'unixepoch', 'localtime') AS day,
              SUM(duration) AS total_seconds
       FROM page_stat_data
       GROUP BY day
       HAVING total_seconds >= ?
       ORDER BY day DESC`,
      [MIN_STREAK_SECONDS],
    );

    if (rows.length === 0) {
      return { currentStreak: 0, longestStreak: 0, currentStreakStart: null };
    }

    const days = rows.map((r) => String(r['day']));
    const today = todayISO();

    // Build streaks by scanning from most recent to oldest.
    let currentStreak = 0;
    let currentStreakStart: string | null = null;
    let longestStreak = 0;

    // Check if the most recent day is today or yesterday.
    const mostRecentDay = days[0]!;
    const daysDiff = dateDiffDays(mostRecentDay, today);

    if (daysDiff > 1) {
      // Most recent reading was more than 1 day ago — no current streak.
      currentStreak = 0;
      currentStreakStart = null;
    } else {
      // Count the current streak.
      currentStreak = 1;
      currentStreakStart = mostRecentDay;

      for (let i = 1; i < days.length; i++) {
        const prevDay = days[i - 1]!;
        const thisDay = days[i]!;
        if (dateDiffDays(thisDay, prevDay) === 1) {
          currentStreak++;
          currentStreakStart = thisDay;
        } else {
          break;
        }
      }
    }

    // Find longest streak across all days.
    let run = 1;
    for (let i = 1; i < days.length; i++) {
      const prevDay = days[i - 1]!;
      const thisDay = days[i]!;
      if (dateDiffDays(thisDay, prevDay) === 1) {
        run++;
      } else {
        longestStreak = Math.max(longestStreak, run);
        run = 1;
      }
    }
    longestStreak = Math.max(longestStreak, run);
    longestStreak = Math.max(longestStreak, currentStreak);

    return { currentStreak, longestStreak, currentStreakStart };
  }

  // ── Overall stats ──────────────────────────────────────────────────

  async getOverallStats(): Promise<OverallStats> {
    const today = todayISO();
    const weekStart = weekStartISO();
    const monthStart = monthStartISO();

    const todayStartUnix = Math.floor(new Date(`${today}T00:00:00`).getTime() / 1000);
    const weekStartUnix = Math.floor(new Date(`${weekStart}T00:00:00`).getTime() / 1000);
    const monthStartUnix = Math.floor(new Date(`${monthStart}T00:00:00`).getTime() / 1000);
    const nowUnix = Math.floor(Date.now() / 1000);

    // Run the aggregation queries in parallel.
    const [totalRow, todayRow, weekRow, monthRow, booksRow, pagesRow] = await Promise.all([
      this.db.select<DatabaseRow>(`SELECT COALESCE(SUM(duration), 0) AS v FROM page_stat_data`),
      this.db.select<DatabaseRow>(
        `SELECT COALESCE(SUM(duration), 0) AS v FROM page_stat_data WHERE start_time >= ? AND start_time <= ?`,
        [todayStartUnix, nowUnix],
      ),
      this.db.select<DatabaseRow>(
        `SELECT COALESCE(SUM(duration), 0) AS v FROM page_stat_data WHERE start_time >= ? AND start_time <= ?`,
        [weekStartUnix, nowUnix],
      ),
      this.db.select<DatabaseRow>(
        `SELECT COALESCE(SUM(duration), 0) AS v FROM page_stat_data WHERE start_time >= ? AND start_time <= ?`,
        [monthStartUnix, nowUnix],
      ),
      this.db.select<DatabaseRow>(`SELECT COUNT(DISTINCT id_book) AS v FROM page_stat_data`),
      this.db.select<DatabaseRow>(
        `SELECT COUNT(DISTINCT id_book || '-' || page) AS v FROM page_stat_data`,
      ),
    ]);

    return {
      totalSeconds: Number(totalRow[0]?.['v'] ?? 0),
      todaySeconds: Number(todayRow[0]?.['v'] ?? 0),
      weekSeconds: Number(weekRow[0]?.['v'] ?? 0),
      monthSeconds: Number(monthRow[0]?.['v'] ?? 0),
      booksRead: Number(booksRow[0]?.['v'] ?? 0),
      totalPages: Number(pagesRow[0]?.['v'] ?? 0),
    };
  }

  // ── Private accessor ───────────────────────────────────────────────

  /** Access the underlying DatabaseService via StatisticsDb's private `db` field. */
  private get db() {
    // StatisticsDb wraps a DatabaseService as a private field. We access it
    // through the same pattern the class itself uses — cast to any to reach
    // the private member. This avoids modifying StatisticsDb's public API.
    return (this.stats as unknown as { db: import('@/types/database').DatabaseService }).db;
  }
}

// ── Date helpers ──────────────────────────────────────────────────────

/** Number of calendar days between two 'YYYY-MM-DD' strings (b - a). */
function dateDiffDays(a: string, b: string): number {
  const msA = new Date(`${a}T00:00:00`).getTime();
  const msB = new Date(`${b}T00:00:00`).getTime();
  return Math.round((msB - msA) / (24 * 60 * 60 * 1000));
}
