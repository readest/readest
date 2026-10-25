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

/** One book's reading totals, derived from its page events. */
export interface BookReadingStat {
  bookMd5: string;
  title: string;
  authors: string;
  /** Seconds read across all page events. */
  seconds: number;
  /** Furthest page reached, 1-based and rescaled to `totalPages`. */
  furthestPage: number;
  /** The book's page count from its latest page event, or 0 when unknown. */
  totalPages: number;
  /** Unix seconds when the last page visit ended. */
  lastRead: number;
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
