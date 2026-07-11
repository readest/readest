import { useEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { updateXRayForProgress } from '@/services/ai/xrayService';
import { aiStore } from '@/services/ai';

export const useXRayAutoUpdate = (bookKey: string) => {
  const { appService } = useEnv();
  const { getBookData } = useBookDataStore();
  const progress = useBookProgress(bookKey);
  const { settings } = useSettingsStore();

  const bookData = getBookData(bookKey);

  const latestRef = useRef({ progress, bookData, settings, appService, bookKey });
  const lastUpdateRef = useRef(0);
  const lastPageRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  type IdleHandle = number | ReturnType<typeof setTimeout>;
  const idleRef = useRef<IdleHandle | null>(null);
  const inFlightRef = useRef(false);
  const pendingUpdateRef = useRef(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    lastUpdateRef.current = 0;
    lastPageRef.current = null;
    pendingUpdateRef.current = false;
  }, [bookKey]);

  useEffect(() => {
    latestRef.current = { progress, bookData, settings, appService, bookKey };
  }, [progress, bookData, settings, appService, bookKey]);

  useEffect(() => {
    const scheduleIdleUpdate = () => {
      if (!mountedRef.current || idleRef.current) return;
      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        const idleCallback = window.requestIdleCallback;
        idleRef.current = idleCallback(
          () => {
            idleRef.current = null;
            void attemptUpdate();
          },
          { timeout: 1500 },
        );
        return;
      }
      idleRef.current = setTimeout(() => {
        idleRef.current = null;
        void attemptUpdate();
      }, 0);
    };

    const scheduleUpdate = () => {
      if (!mountedRef.current || timerRef.current || idleRef.current) return;
      const delay = Math.max(0, 3000 - (Date.now() - lastUpdateRef.current));
      if (delay === 0) {
        scheduleIdleUpdate();
        return;
      }
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        scheduleIdleUpdate();
      }, delay);
    };

    const attemptUpdate = async () => {
      if (inFlightRef.current) {
        pendingUpdateRef.current = true;
        return;
      }
      inFlightRef.current = true;
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
        await updateXRayForProgress({
          bookHash,
          currentPage,
          settings: aiSettings,
          bookTitle: bookData.book.title || 'Unknown',
          appService,
          bookMetadata: bookData.book.metadata,
        });
      } catch {
      } finally {
        inFlightRef.current = false;
        if (pendingUpdateRef.current) {
          pendingUpdateRef.current = false;
          scheduleUpdate();
        }
      }
    };

    scheduleUpdate();

    return () => {
      if (idleRef.current) {
        if (
          typeof idleRef.current === 'number' &&
          typeof window !== 'undefined' &&
          'cancelIdleCallback' in window
        ) {
          window.cancelIdleCallback(idleRef.current);
        } else {
          clearTimeout(idleRef.current);
        }
        idleRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [
    appService,
    bookData?.book,
    bookKey,
    progress?.pageinfo?.current,
    settings?.aiSettings?.aiGatewayApiKey,
    settings?.aiSettings?.enabled,
    settings?.aiSettings?.provider,
  ]);
};
