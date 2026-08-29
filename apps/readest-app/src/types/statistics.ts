// KOReader-compatible reading-statistics types.
//
// The canonical unit is the per-page read event (KOReader's page_stat_data
// row). Aggregates (sessions, streaks, totals) are DERIVED via SQL, never
// stored as separate records. Times are Unix seconds; pages are 1-based.

/** One immutable page-read event — a KOReader `page_stat_data` row. */
export interface PageStatEvent {
  bookMd5: string; // = Book.hash = KOReader book.md5
  page: number; // 1-based
  startTime: number; // Unix seconds
  duration: number; // seconds
  totalPages: number;
}

/** KOReader book identity — the only book metadata that syncs. */
export interface StatBook {
  bookMd5: string;
  title: string;
  authors: string; // KOReader stores authors as a single text field
}

/** Tunables for the tracker's flush/idle behavior. KOReader-aligned defaults. */
export interface StatsTrackingConfig {
  /** Seconds of inactivity before the current page event is flushed + paused. */
  idleTimeoutSeconds: number;
  /** Hard per-event duration cap (safety net if a visibility event is missed). */
  maxEventSeconds: number;
  /** Events shorter than this are dropped (ignore sub-second page flips). */
  minEventSeconds: number;
}

export const DEFAULT_STATS_TRACKING_CONFIG: StatsTrackingConfig = {
  idleTimeoutSeconds: 120,
  maxEventSeconds: 120,
  minEventSeconds: 3,
};

/** Aggregates derived on demand over page_stat_data — never stored or synced. */

/** The stats dialog's time scope. Week starts Monday; month/year are calendar units; all local time. */
export type StatsPeriod = 'total' | 'year' | 'month' | 'week';

/** All-time totals for the "总计" summary card. */
export interface TotalReadStats {
  totalSeconds: number;
  /** Distinct LOCAL days (per tzOffsetSecs) with any recorded reading. */
  readDays: number;
  firstStartTime: number | null;
}

/** Reading seconds bucketed into one LOCAL day; `dayStartTs` is the UTC Unix second of that day's local midnight. */
export interface DailyReadTime {
  dayStartTs: number;
  seconds: number;
}

/** Per-book reading time within a period, for the ranking list. */
export interface BookReadTime {
  bookMd5: string;
  title: string;
  authors: string;
  seconds: number;
  /** Distinct pages touched in the period (engine-relative; informational only). */
  pages: number;
}
