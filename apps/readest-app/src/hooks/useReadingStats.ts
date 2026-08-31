import { useCallback, useEffect, useRef, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useLibraryStore } from '@/store/libraryStore';
import { StatisticsDb } from '@/services/statistics/statisticsDb';
import { pullStats } from '@/services/statistics/statsSync';
import { pullStatsSnapshots } from '@/services/statistics/statsFileSync';
import { SyncClient } from '@/libs/sync';
import { isSyncCategoryEnabled } from '@/services/sync/syncCategories';
import type { Book } from '@/types/book';
import type { BookReadTime, DailyReadTime, StatsPeriod, TotalReadStats } from '@/types/statistics';
import { getPeriodRange, periodRangeToSeconds } from '@/utils/stats';

/** Only meaningful reading sessions belong in a ranking. */
export const MIN_RANKING_SECONDS = 5 * 60;

/** One ranking row: same-book editions merged by (title, authors). */
export interface RankedBook {
  key: string;
  title: string;
  authors: string;
  seconds: number;
  /** How many md5 editions were merged into this row (1 = single edition). */
  versions: number;
  /** Matched library book for the cover and the details dialog; null if none. */
  book: Book | null;
}

export interface ReadingStatsData {
  loading: boolean;
  totals: TotalReadStats | null;
  periodSeconds: number;
  daily: DailyReadTime[];
  ranking: RankedBook[];
}

const EMPTY: ReadingStatsData = {
  loading: true,
  totals: null,
  periodSeconds: 0,
  daily: [],
  ranking: [],
};

/**
 * Placeholder title of a stats book whose metadata record never arrived
 * (StatisticsDb.ensureBookId seeds it with the md5).
 */
const isPlaceholderTitle = (title: string, bookMd5: string): boolean => !title || title === bookMd5;

/** Merge same-work editions, remove noise, then rank by meaningful reading time. */
export const mergeEditions = (
  rows: BookReadTime[],
  booksByHash: Map<string, Book>,
): RankedBook[] => {
  const groups = new Map<string, RankedBook>();
  for (const row of rows) {
    const placeholder = isPlaceholderTitle(row.title, row.bookMd5);
    const title = placeholder ? '' : row.title.trim();
    const key = placeholder
      ? `unknown\u0000${row.bookMd5}`
      : `${title.toLowerCase()}\u0000${row.authors.trim().toLowerCase()}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, title, authors: row.authors.trim(), seconds: 0, versions: 0, book: null };
      groups.set(key, group);
    }
    group.seconds += row.seconds;
    group.versions += 1;
    if (!group.book) group.book = booksByHash.get(row.bookMd5) ?? null;
  }
  return [...groups.values()]
    .filter((row) => row.seconds >= MIN_RANKING_SECONDS)
    .sort((a, b) => b.seconds - a.seconds);
};

/**
 * Loads reading-time aggregates from the local statistics.db for the stats
 * dialog. `enabled` gates loading (the dialog only queries while open). The
 * db handle is the shared per-tab singleton, so this never fights the reader
 * trackers for the OPFS file handle.
 */
export const useReadingStats = (enabled: boolean, period: StatsPeriod): ReadingStatsData => {
  const { appService } = useEnv();
  const { user } = useAuth();
  const [data, setData] = useState<ReadingStatsData>(EMPTY);
  const seqRef = useRef(0);

  const load = useCallback(async (db: StatisticsDb, currentPeriod: StatsPeriod) => {
    const seq = ++seqRef.current;
    const { fromTs, toTs } = periodRangeToSeconds(getPeriodRange(currentPeriod));
    try {
      const [totals, periodSeconds, daily, bookTimes] = await Promise.all([
        db.getTotalReadStats(),
        db.getReadTimeBetween(fromTs, toTs),
        db.getDailyReadTimeBetween(fromTs, toTs),
        db.getBookReadTimesBetween(fromTs, toTs, 200),
      ]);
      if (seq !== seqRef.current) return;
      const { getBookByHash } = useLibraryStore.getState();
      const booksByHash = new Map<string, Book>();
      for (const row of bookTimes) {
        if (booksByHash.has(row.bookMd5)) continue;
        const book = getBookByHash(row.bookMd5);
        if (book && !book.deletedAt) booksByHash.set(row.bookMd5, book);
      }
      setData({
        loading: false,
        totals,
        periodSeconds,
        daily,
        ranking: mergeEditions(bookTimes, booksByHash),
      });
    } catch (err) {
      console.warn('[stats] failed to load reading stats:', err);
      if (seq === seqRef.current) setData({ ...EMPTY, loading: false });
    }
  }, []);

  useEffect(() => {
    if (!enabled || !appService) return;
    let cancelled = false;
    void StatisticsDb.open(appService)
      .then(async (db) => {
        if (cancelled) return;
        if (user && isSyncCategoryEnabled('stats')) {
          try {
            await pullStats(db, new SyncClient());
          } catch (err) {
            console.warn('[stats] background pull failed:', err);
          }
        }
        try {
          await pullStatsSnapshots(db);
        } catch (err) {
          console.warn('[stats] snapshot pull failed:', err);
        }
        if (cancelled) return;
        await load(db, period);
      })
      .catch((err) => {
        console.warn('[stats] failed to open statistics db:', err);
        if (!cancelled) setData({ ...EMPTY, loading: false });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, appService, period, user, load]);

  return data;
};
