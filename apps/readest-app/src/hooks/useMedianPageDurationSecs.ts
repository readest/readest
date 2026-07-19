import { useEffect, useState } from 'react';
import { useEnv } from '@/context/EnvContext';
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

    void load();
  }, [appService, bookMd5]);

  return medianPageDurationSecs;
};
