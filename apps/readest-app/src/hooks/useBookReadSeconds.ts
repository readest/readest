import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
import { StatisticsDb } from '@/services/statistics/statisticsDb';

/**
 * Total reading seconds recorded for a book (keyed by its partialMD5 hash),
 * or null when the book has no recorded time. Shares the per-tab statistics
 * connection, so it never conflicts with the reader trackers.
 */
export const useBookReadSeconds = (bookHash: string | undefined): number | null => {
  const { appService } = useEnv();
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!appService || !bookHash) return;
    let cancelled = false;
    void StatisticsDb.open(appService)
      .then(async (db) => {
        const row = await db.getBookByMd5(bookHash);
        if (cancelled) return;
        const total = row ? Number(row.total_read_time) : 0;
        setSeconds(total > 0 ? total : null);
      })
      .catch((err) => {
        console.warn('[stats] failed to load book reading time:', err);
        if (!cancelled) setSeconds(null);
      });
    return () => {
      cancelled = true;
    };
  }, [appService, bookHash]);

  return seconds;
};
