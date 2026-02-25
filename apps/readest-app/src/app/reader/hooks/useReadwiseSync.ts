import { useCallback, useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { debounce } from '@/utils/debounce';
import { ReadwiseClient } from '@/services/readwise';

const READWISE_SYNC_DEBOUNCE_MS = 5000;

export const useReadwiseSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();

  // Read settings from store at call time to avoid stale closures
  const updateLastSyncedAt = useCallback(
    async (timestamp: number) => {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const newSettings = {
        ...settings,
        readwise: { ...settings.readwise, lastSyncedAt: timestamp },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [envConfig],
  );

  // useMemo (not useCallback) so the debounce timer isn't reset on every render
  const debouncedPush = useMemo(
    () =>
      debounce(async () => {
        const { settings } = useSettingsStore.getState();
        if (!settings.readwise?.enabled || !settings.readwise?.accessToken) return;
        const client = new ReadwiseClient(settings.readwise);
        const book = getBookData(bookKey)?.book;
        const config = getConfig(bookKey);
        if (!book || !config?.booknotes) return;

        const lastSyncedAt = settings.readwise.lastSyncedAt ?? 0;
        const newNotes = config.booknotes.filter(
          (n) => n.updatedAt > lastSyncedAt || (n.deletedAt ?? 0) > lastSyncedAt,
        );
        if (newNotes.length === 0) return;

        const result = await client.pushHighlights(newNotes, book);
        if (result.success) {
          await updateLastSyncedAt(Date.now());
        } else if (!result.isNetworkError) {
          console.error('Readwise sync failed:', result.message);
        }
      }, READWISE_SYNC_DEBOUNCE_MS),
    [bookKey, getBookData, getConfig, updateLastSyncedAt],
  );

  // Manual "Push All": sends every annotation/excerpt regardless of sync timestamp
  const pushAllHighlights = useCallback(async () => {
    const { settings } = useSettingsStore.getState();
    if (!settings.readwise?.enabled || !settings.readwise?.accessToken) return;
    const client = new ReadwiseClient(settings.readwise);
    const book = getBookData(bookKey)?.book;
    const config = getConfig(bookKey);
    if (!book || !config?.booknotes) return;

    const result = await client.pushHighlights(config.booknotes, book);
    if (result.success) {
      await updateLastSyncedAt(Date.now());
      eventDispatcher.dispatch('toast', {
        message: _('Highlights synced to Readwise'),
        type: 'success',
      });
    } else {
      const message = result.isNetworkError
        ? _('Readwise sync failed: no internet connection')
        : _('Readwise sync failed: {{error}}', { error: result.message });
      eventDispatcher.dispatch('toast', { message, type: 'error' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, getBookData, getConfig, updateLastSyncedAt]);

  // Cancel any pending debounced sync on unmount to avoid background network requests
  useEffect(() => {
    return () => {
      debouncedPush.cancel();
    };
  }, [debouncedPush]);

  // Listen for manual push-all events dispatched from BookMenu / BooknoteView
  useEffect(() => {
    const handlePushAll = async (e: CustomEvent) => {
      if (e.detail.bookKey !== bookKey) return;
      await pushAllHighlights();
    };
    eventDispatcher.on('readwise-push-all', handlePushAll);
    return () => {
      eventDispatcher.off('readwise-push-all', handlePushAll);
    };
  }, [bookKey, pushAllHighlights]);

  // Auto-sync whenever booknotes change; debouncedPush reads enabled state internally
  const config = getConfig(bookKey);
  useEffect(() => {
    debouncedPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.booknotes]);

  return { pushAllHighlights };
};
