import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookConfig, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { serializeConfig } from '@/utils/serializer';
import { CFI } from '@/libs/document';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';
import { DEFAULT_BOOK_SEARCH_CONFIG, SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';
import { getCFIFromXPointer, getXPointerFromCFI, normalizeProgressXPointer } from '@/utils/xcfi';

export const useProgressSync = (bookKey: string) => {
  const _ = useTranslation();
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const { settings } = useSettingsStore();
  const { syncedConfigs, syncConfigs } = useSync(bookKey);
  const { user } = useAuth();
  const config = getConfig(bookKey);
  const progress = getProgress(bookKey);

  const configPulled = useRef(false);
  const hasPulledConfigOnce = useRef(false);

  const pushConfig = (bookKey: string, config: BookConfig | null) => {
    if (!config || !user) return;
    const bookHash = bookKey.split('-')[0]!;
    const newConfig = { ...config, bookHash };
    const compressedConfig = JSON.parse(
      serializeConfig(newConfig, settings.globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG),
    );
    delete compressedConfig.booknotes;
    syncConfigs([compressedConfig], bookHash, 'push');
  };

  const pullConfig = (bookKey: string) => {
    if (!user) return;
    const bookHash = bookKey.split('-')[0]!;
    syncConfigs([], bookHash, 'pull');
  };

  const syncConfig = async () => {
    if (!configPulled.current) {
      pullConfig(bookKey);
    } else {
      const config = getConfig(bookKey);
      const view = getView(bookKey);
      const book = getBookData(bookKey)?.book;
      if (config && view && book && config.progress && config.progress[0] > 0) {
        try {
          const content = view.renderer.getContents()[0];
          if (content && !FIXED_LAYOUT_FORMATS.has(book.format)) {
            const { doc, index } = content;
            const xpointerResult = await getXPointerFromCFI(config.location!, doc, index || 0);
            config.xpointer = normalizeProgressXPointer(xpointerResult.xpointer);
          }
        } catch (error) {
          console.warn('Failed to convert CFI to XPointer', error);
        }
        pushConfig(bookKey, config);
      }
    }
  };

  const handleSyncBookProgress = (event: CustomEvent) => {
    const { bookKey: syncBookKey } = event.detail;
    if (syncBookKey === bookKey) {
      syncConfig();
    }
  };

  // Push: ad-hoc push when the book is closed
  useEffect(() => {
    eventDispatcher.on('sync-book-progress', handleSyncBookProgress);
    return () => {
      eventDispatcher.off('sync-book-progress', handleSyncBookProgress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    debounce(() => {
      syncConfig();
    }, SYNC_PROGRESS_INTERVAL_SEC * 1000),
    [],
  );

  // Push: auto-push progress when progress changes with a debounce
  useEffect(() => {
    if (!progress?.location || !user) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // Pull: pull progress once when the book is opened
  useEffect(() => {
    if (!progress || hasPulledConfigOnce.current) return;
    hasPulledConfigOnce.current = true;
    pullConfig(bookKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const applyRemoteProgress = useCallback(async () => {
    if (!syncedConfigs || syncedConfigs.length === 0) return;
    const syncedConfig = syncedConfigs.filter((c) => c.bookHash === bookKey.split('-')[0])[0];
    if (syncedConfig) {
      const configCFI = config?.location;
      let remoteCFILocation = syncedConfig.location;
      const xPointer = syncedConfig.xpointer;
      const bookData = getBookData(bookKey);
      const view = getView(bookKey);
      if (xPointer && view && bookData && bookData.bookDoc) {
        const content = view.renderer.getContents()[0];
        const koProgress = normalizeProgressXPointer(xPointer);
        const candidateCFI = await getCFIFromXPointer(
          koProgress,
          content?.doc,
          content?.index,
          bookData.bookDoc,
        );
        if (CFI.compare(remoteCFILocation, candidateCFI) < 0) {
          remoteCFILocation = candidateCFI;
        }
      }
      setConfig(bookKey, syncedConfig);
      if (remoteCFILocation && configCFI) {
        if (CFI.compare(configCFI, remoteCFILocation) < 0) {
          if (view) {
            view.goTo(remoteCFILocation);
            eventDispatcher.dispatch('hint', {
              bookKey,
              message: _('Reading Progress Synced'),
            });
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedConfigs, config?.location]);

  // Pull: proccess the pulled progress
  useEffect(() => {
    if (!configPulled.current && syncedConfigs) {
      configPulled.current = true;
      applyRemoteProgress().catch((error) => {
        console.error('Failed to apply remote progress', error);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyRemoteProgress]);
};
