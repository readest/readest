import { useEffect, useRef } from 'react';

import { useEnv } from '@/context/EnvContext';
import type { AISettings } from '@/services/ai/types';
import { getXRayService } from '@/services/ai/xray/XRayService';
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
      !hasCredentials(aiSettings)
    ) {
      scheduler.current = null;
      return;
    }

    const nextScheduler = new XRayScheduler(
      async (update, signal) => {
        const service = await getXRayService(appService, aiSettings);
        const result = await service.updateForProgress({
          ...update,
          indexIfNeeded: aiSettings.indexingMode === 'background',
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
      bookDoc,
      metadata: {
        title: formatTitle(bookDoc.metadata.title),
        description: bookDoc.metadata.description,
        subject: getContributorNames(bookDoc.metadata.subject),
      },
    });
  }, [aiSettings, appService, bookDoc, bookHash, progress?.location]);
};

const hasCredentials = (settings: AISettings): boolean => {
  if (settings.provider === 'ai-gateway') return !!settings.aiGatewayApiKey;
  if (settings.provider === 'openrouter') return !!settings.openrouterApiKey;
  return true;
};
