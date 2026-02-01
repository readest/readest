import { useEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { updateXRayForProgress } from '@/services/ai/xrayService';

export const useXRayAutoUpdate = (bookKey: string) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const { getProgress } = useReaderStore();
  const { settings } = useSettingsStore();

  const progress = getProgress(bookKey);
  const bookData = getBookData(bookKey);

  const latestRef = useRef({ progress, bookData, settings, appService, bookKey });
  const lastUpdateRef = useRef(0);

  useEffect(() => {
    latestRef.current = { progress, bookData, settings, appService, bookKey };
  }, [progress, bookData, settings, appService, bookKey]);

  useEffect(() => {
    const now = Date.now();
    if (now - lastUpdateRef.current < 20000) return;

    const { progress, bookData, settings, appService, bookKey } = latestRef.current;
    const aiSettings = settings?.aiSettings;
    if (!aiSettings?.enabled) return;
    if (!bookData?.book) return;
    const bookHash = bookKey.split('-')[0] || '';
    if (!bookHash) return;
    const currentPage = progress?.pageinfo?.current ?? 0;

    lastUpdateRef.current = now;
    void updateXRayForProgress({
      bookHash,
      currentPage,
      settings: aiSettings,
      bookTitle: bookData.book.title || 'Unknown',
      appService,
    });
  }, [bookKey, progress?.pageinfo?.current, progress?.section?.current]);
};
