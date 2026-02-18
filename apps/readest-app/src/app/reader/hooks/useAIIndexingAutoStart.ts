import { useEffect, useRef } from 'react';

import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { aiStore, indexBook, isBookIndexed } from '@/services/ai';

export const useAIIndexingAutoStart = (bookKey: string) => {
  const { getBookData } = useBookDataStore();
  const { settings } = useSettingsStore();
  const bookData = getBookData(bookKey);
  const inFlightRef = useRef(false);

  useEffect(() => {
    const attemptIndex = async () => {
      try {
        if (inFlightRef.current) return;
        const aiSettings = settings?.aiSettings;
        if (!aiSettings?.enabled) return;
        if (
          aiSettings.provider === 'ai-gateway' &&
          typeof window !== 'undefined' &&
          !aiSettings.aiGatewayApiKey
        )
          return;
        if (!bookData?.bookDoc) return;
        const bookHash = bookKey.split('-')[0] || '';
        if (!bookHash) return;
        const indexed = await isBookIndexed(bookHash);
        if (indexed) return;
        const indexingState = await aiStore.getIndexingState(bookHash);
        const shouldResume = indexingState?.status === 'indexing';
        const shouldBackground = aiSettings.indexingMode === 'background';
        if (!shouldResume && !shouldBackground) return;
        inFlightRef.current = true;
        try {
          await indexBook(
            bookData.bookDoc as Parameters<typeof indexBook>[0],
            bookHash,
            aiSettings,
          );
        } finally {
          inFlightRef.current = false;
        }
      } catch {}
    };

    void attemptIndex();
  }, [bookData?.bookDoc, bookKey, settings]);
};
