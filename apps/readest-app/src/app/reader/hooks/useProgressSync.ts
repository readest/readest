import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookConfig } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { serializeConfig } from '@/utils/serializer';
import { CFI } from '@/libs/document';
import { eventDispatcher } from '@/utils/event';
import { DEFAULT_BOOK_SEARCH_CONFIG, SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';

export const useProgressSync = (bookKey: string) => {
  const _ = useTranslation();
  const { getConfig, setConfig } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const { settings } = useSettingsStore();
  const { syncedConfigs, syncConfigs } = useSync(bookKey);
  const { user } = useAuth();
  const view = getView(bookKey);
  const config = getConfig(bookKey);
  const progress = getProgress(bookKey);
  // flag to prevent accidental sync without first pulling the config
  const configSynced = useRef(false);
  const firstPulled = useRef(false);

  const pushConfig = (bookKey: string, config: BookConfig | null) => {
    if (!config || !user) return;
    const bookHash = bookKey.split('-')[0]!;
    const newConfig = { bookHash, ...config };
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
  const syncConfig = () => {
    if (!configSynced.current) {
      pullConfig(bookKey);
    } else {
      if (config && config.progress && config.progress[0] > 0) {
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

  useEffect(() => {
    eventDispatcher.on('sync-book-progress', handleSyncBookProgress);
    return () => {
      eventDispatcher.off('sync-book-progress', handleSyncBookProgress);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    if (!progress || firstPulled.current) return;
    firstPulled.current = true;
    pullConfig(bookKey);

    return () => {
      syncConfig();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const lastProgressSyncTime = useRef<number>(0);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!config?.location || !user) return;

    const now = Date.now();
    const timeSinceLastSync = now - lastProgressSyncTime.current;
    if (timeSinceLastSync > SYNC_PROGRESS_INTERVAL_SEC * 1000) {
      lastProgressSyncTime.current = now;
      syncConfig();
    } else {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(
        () => {
          lastProgressSyncTime.current = Date.now();
          syncTimeoutRef.current = null;
          syncConfig();
        },
        SYNC_PROGRESS_INTERVAL_SEC * 1000 - timeSinceLastSync,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // sync progress once when the book is opened
  useEffect(() => {
    if (!configSynced.current && syncedConfigs) {
      configSynced.current = true;
      const syncedConfig = syncedConfigs.filter((c) => c.bookHash === bookKey.split('-')[0])[0];
      if (syncedConfig) {
        const configCFI = config?.location;
        const syncedCFI = syncedConfig.location;
        setConfig(bookKey, syncedConfig);
        if (syncedCFI && configCFI) {
          if (CFI.compare(configCFI, syncedCFI) < 0) {
            if (view) {
              view.goTo(syncedCFI);
              eventDispatcher.dispatch('hint', {
                bookKey,
                message: _('Reading Progress Synced'),
              });
            }
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedConfigs]);
};
