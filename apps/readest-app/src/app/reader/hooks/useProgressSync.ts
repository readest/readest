import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookConfig } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { deserializeConfig, serializeConfig } from '@/utils/serializer';
import { eventDispatcher } from '@/utils/event';
import { DEFAULT_BOOK_SEARCH_CONFIG, SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';

export const useProgressSync = (bookKey: string) => {
  const _ = useTranslation();
  const { getConfig, setConfig } = useBookDataStore();
  const { getView } = useReaderStore();
  const { settings } = useSettingsStore();
  const { syncedConfigs, syncConfigs } = useSync(bookKey);
  const { user } = useAuth();
  const view = getView(bookKey);
  const config = getConfig(bookKey);
  // flag to prevent accidental sync without first pulling the config
  const configSynced = useRef(false);

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

  useEffect(() => {
    if (!user) return;
    pullConfig(bookKey);
    // return () => {
    //   if (configSynced.current) {
    //     pushConfig(bookKey, config);
    //   }
    // };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const newConfig = deserializeConfig(
          JSON.stringify(syncedConfig),
          settings.globalViewSettings,
          DEFAULT_BOOK_SEARCH_CONFIG,
        );
        setConfig(bookKey, { ...config, ...newConfig });
        if ((syncedConfig.progress?.[1] ?? 0) > 0 && (config?.progress?.[1] ?? 0) > 0) {
          const syncedFraction = syncedConfig.progress![0] / syncedConfig.progress![1];
          const configFraction = config!.progress![0] / config!.progress![1];
          if (syncedFraction > configFraction) {
            view?.goToFraction(syncedFraction);
            eventDispatcher.dispatch('toast', {
              type: 'success',
              message: _('Reading Progress Synced'),
            });
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedConfigs]);
};
