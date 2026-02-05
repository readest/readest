import { useEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { updateXRayForProgress } from '@/services/ai/xrayService';
import { aiStore } from '@/services/ai';

export const useXRayAutoUpdate = (bookKey: string) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const progress = useReaderStore((state) => state.getProgress(bookKey));
  const { settings } = useSettingsStore();

  const bookData = getBookData(bookKey);

  const latestRef = useRef({ progress, bookData, settings, appService, bookKey });
  const lastUpdateRef = useRef(0);
  const lastPageRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestRef.current = { progress, bookData, settings, appService, bookKey };
  }, [progress, bookData, settings, appService, bookKey]);

  useEffect(() => {
    const attemptUpdate = async () => {
      try {
        const now = Date.now();
        const { progress, bookData, settings, appService, bookKey } = latestRef.current;
        const aiSettings = settings?.aiSettings;
        if (!aiSettings?.enabled) return;
        if (aiSettings.provider !== 'ai-gateway') return;
        if (typeof window !== 'undefined' && !aiSettings.aiGatewayApiKey) return;
        if (!bookData?.book) return;
        const bookHash = bookKey.split('-')[0] || '';
        if (!bookHash) return;
        const currentPage = progress?.pageinfo?.current ?? 0;
        const xrayState = await aiStore.getXRayState(bookHash);
        const hasPending =
          !!xrayState?.pendingToPage && xrayState.pendingToPage > xrayState.lastAnalyzedPage;

        if (lastPageRef.current === currentPage && !hasPending) return;
        if (now - lastUpdateRef.current < 3000) return;

        lastUpdateRef.current = now;
        lastPageRef.current = currentPage;
        void updateXRayForProgress({
          bookHash,
          currentPage,
          settings: aiSettings,
          bookTitle: bookData.book.title || 'Unknown',
          appService,
          bookMetadata: bookData.book.metadata,
        });
      } catch {}
    };

    const scheduleUpdate = () => {
      if (timerRef.current) return;
      const delay = Math.max(0, 3000 - (Date.now() - lastUpdateRef.current));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        void attemptUpdate();
      }, delay);
    };

    void attemptUpdate();
    scheduleUpdate();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [bookKey]);
};
