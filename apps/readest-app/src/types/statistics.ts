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
  /** Unix seconds. Set when the book's statistics were deleted: events that started before it are gone. */
  deletedAt?: number;
}

/** One book's totals, as listed for managing statistics (a type, so it is a DatabaseRow). */
export type BookStats = {
  md5: string;
  title: string;
  authors: string;
  seconds: number;
  pages: number;
  lastRead: number; // Unix seconds
};

export type ReadingSpeedUnit = 'characters' | 'words';

export type ReadingSpeed = {
  unit: ReadingSpeedUnit;
  count: number;
  durationMs: number;
};

export type ReadingSpeedSample = ReadingSpeed & { startTimeMs: number };

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

/** No reading speed sample is timed longer than this. */
export const MAX_READING_SPEED_SAMPLE_MS = 15 * 60_000;
