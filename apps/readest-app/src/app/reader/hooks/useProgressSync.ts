import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookConfig } from '@/types/book';
import { deserializeConfig, serializeConfig } from '@/utils/serializer';
import { useBookDataStore } from '@/store/bookDataStore';
import { DEFAULT_BOOK_SEARCH_CONFIG, SYNC_PROGRESS_INTERVAL_SEC } from '@/services/constants';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';

export const useProgressSync = (
  bookKey: string,
  config: BookConfig,
  setToastMessage?: React.Dispatch<React.SetStateAction<string>>,
) => {
  const { setConfig } = useBookDataStore();
  const { getView } = useReaderStore();
  const { settings } = useSettingsStore();
  const { syncedConfigs, syncConfigs } = useSync();
  const { user } = useAuth();
  const view = getView(bookKey);

  const pushConfig = (bookKey: string, config: BookConfig) => {
    const bookHash = bookKey.split('-')[0]!;
    const newConfig = { bookHash, ...config };
    const compressedConfig = JSON.parse(
      serializeConfig(newConfig, settings.globalViewSettings, DEFAULT_BOOK_SEARCH_CONFIG),
    );
    syncConfigs([compressedConfig], bookHash, 'push');
  };

  useEffect(() => {
    if (!user) return;
    const bookHash = bookKey.split('-')[0]!;
    syncConfigs([], bookHash, 'pull');
    return () => {
      pushConfig(bookKey, config);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastProgressSyncTime = useRef<number>(0);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!user) return;
    const now = Date.now();
    const timeSinceLastSync = now - lastProgressSyncTime.current;
    if (configSynced.current && timeSinceLastSync > SYNC_PROGRESS_INTERVAL_SEC * 1000) {
      lastProgressSyncTime.current = now;
      pushConfig(bookKey, config);
    } else {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(
        () => {
          lastProgressSyncTime.current = Date.now();
          pushConfig(bookKey, config);
          syncTimeoutRef.current = null;
        },
        SYNC_PROGRESS_INTERVAL_SEC * 1000 - timeSinceLastSync,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  // sync progress once when the book is opened
  const configSynced = useRef(false);
  useEffect(() => {
    if (!configSynced.current && syncedConfigs?.length > 0) {
      const syncedConfig = syncedConfigs.filter((c) => c.bookHash === bookKey.split('-')[0])[0];
      if (syncedConfig) {
        const newConfig = deserializeConfig(
          JSON.stringify(syncedConfig),
          settings.globalViewSettings,
          DEFAULT_BOOK_SEARCH_CONFIG,
        );
        setConfig(bookKey, { ...config, ...newConfig });
        configSynced.current = true;
        if ((syncedConfig.progress?.[1] ?? 0) > 0 && (config.progress?.[1] ?? 0) > 0) {
          const syncedFraction = syncedConfig.progress![0] / syncedConfig.progress![1];
          const configFraction = config.progress![0] / config.progress![1];
          if (syncedFraction > configFraction) {
            view?.goToFraction(syncedFraction);
            setToastMessage?.('Progress synced');
          }
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedConfigs]);
};
