import { useEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import { hasXRayCredentials as hasCredentials } from '@/services/ai/xray/utils';
import { XRayScheduler } from '@/services/ai/xray/XRayScheduler';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useSettingsStore } from '@/store/settingsStore';
import { formatTitle, getContributorNames } from '@/utils/book';
import { eventDispatcher } from '@/utils/event';

export const useXRayAutoUpdate = (bookKey: string): void => {
  const { appService } = useEnv();
  const bookHash = bookKey.split('-')[0] ?? '';
  const bookDoc = useBookDataStore((state) => state.booksData[bookHash]?.bookDoc ?? null);
  const progress = useBookProgress(bookKey);
  const aiSettings = useSettingsStore((state) => state.settings.aiSettings);
  const scheduler = useRef<XRayScheduler | null>(null);

  useEffect(() => {
    if (
      !appService ||
      appService.appPlatform !== 'tauri' ||
      !aiSettings?.enabled ||
      !aiSettings.reedy?.enabled ||
      !hasCredentials(aiSettings)
    ) {
      scheduler.current = null;
      return;
    }

    const nextScheduler = new XRayScheduler(
      async (update, signal) => {
        const { getXRayService } = await import('@/services/ai/xray/XRayService');
        const service = await getXRayService(appService, aiSettings);
        const result = await service.updateForProgress({
          ...update,
          signal,
        });
        if (result.kind === 'updated') {
          void eventDispatcher.dispatch('xray-updated', {
            bookHash: update.bookHash,
            maxPositionIndex: result.maxPositionIndex,
          });
        }
      },
      {
        onError: (error) => console.warn('[X-Ray] background update failed', error),
      },
    );
    scheduler.current = nextScheduler;
    return () => {
      if (scheduler.current === nextScheduler) scheduler.current = null;
      nextScheduler.dispose();
    };
  }, [aiSettings, appService]);

  useEffect(() => {
    if (!bookHash || !bookDoc || !progress?.location) return;
    scheduler.current?.schedule({
      bookHash,
      currentCfi: progress.location,
      metadata: {
        title: formatTitle(bookDoc.metadata.title),
        description: bookDoc.metadata.description,
        subject: getContributorNames(bookDoc.metadata.subject),
      },
    });
  }, [aiSettings, appService, bookDoc, bookHash, progress?.location]);
};
