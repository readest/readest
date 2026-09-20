import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import type { Book } from '@/types/book';
import { StatisticsDb } from '@/services/statistics/statisticsDb';

/**
 * Median seconds-per-page for a book, read from its reading statistics, or
 * `null` until enough data exists. Used to make time-remaining estimates match
 * the reader's own pace.
 */
export const useMedianPageDurationSecs = (bookMd5?: string): number | null => {
  const { appService } = useEnv();
  const [medianPageDurationSecs, setMedianPageDurationSecs] = useState<number | null>(null);

  useEffect(() => {
    if (!appService || !bookMd5) return;

    const load = async () => {
      const db = await StatisticsDb.open(appService);
      const book = await db.getBookByMd5(bookMd5);
      if (!book) return;
      const median = await db.getMedianPageDurationSecs(book.id);
      setMedianPageDurationSecs(median);
    };

    // Statistics are best-effort: a failed DB open/read (e.g. torn down on app
    // teardown) must never surface as an unhandled rejection (Sentry READEST-6).
    void load().catch((err) => console.warn('[stats] median page duration failed:', err));
  }, [appService, bookMd5]);

  return medianPageDurationSecs;
};

/** Refresh shelf sort values when reading progress or the library changes. */
export const useMedianPageDurationsSecs = (books: Book[], enabled: boolean) => {
  const { appService } = useEnv();
  const [durations, setDurations] = useState<Record<string, number>>({});
  useEffect(() => {
    if (!appService || !enabled) return;
    let cancelled = false;
    void StatisticsDb.open(appService)
      .then((db) => db.getMedianPageDurationsSecs())
      .then((values) => {
        if (!cancelled) setDurations(values);
      })
      .catch((err) => console.warn('[stats] shelf page durations failed:', err));
    return () => {
      cancelled = true;
    };
  }, [appService, books, enabled]);
  return durations;
};
