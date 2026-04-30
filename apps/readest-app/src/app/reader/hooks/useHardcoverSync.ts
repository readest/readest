import { useCallback, useEffect } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { HardcoverClient, HardcoverSyncMapStore } from '@/services/hardcover';
import { BookNote } from '@/types/book';

export const useHardcoverSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();

  const updateLastSyncedAt = useCallback(
    async (timestamp: number) => {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const newSettings = {
        ...settings,
        hardcover: { ...settings.hardcover, lastSyncedAt: timestamp },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [envConfig],
  );

  const getClient = useCallback(async () => {
    const { settings } = useSettingsStore.getState();
    if (!settings.hardcover?.enabled || !settings.hardcover?.accessToken) {
      return null;
    }
    const appService = await envConfig.getAppService();
    const mapStore = new HardcoverSyncMapStore(appService);
    return new HardcoverClient(settings.hardcover, mapStore);
  }, [envConfig]);

  const pushNotes = useCallback(async () => {
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return;
    if (!config.hardcoverSyncEnabled) {
      eventDispatcher.dispatch('toast', {
        message: _('Enable Hardcover sync for this book first.'),
        type: 'info',
      });
      return;
    }

    const eligibleNotes = (config.booknotes ?? []).filter(
      (note: BookNote) =>
        (note.type === 'annotation' || note.type === 'excerpt') && !note.deletedAt,
    );

    if (eligibleNotes.length === 0) {
      eventDispatcher.dispatch('toast', {
        message: _('No annotations or excerpts to sync for this book.'),
        type: 'info',
      });
      return;
    }

    const client = await getClient();
    if (!client) {
      eventDispatcher.dispatch('toast', {
        message: _('Configure Hardcover in Settings first.'),
        type: 'info',
      });
      return;
    }

    try {
      const result = await client.syncBookNotes(book, config);

      await updateLastSyncedAt(Date.now());
      eventDispatcher.dispatch('toast', {
        message:
          result.inserted === 0 && result.updated === 0
            ? _('No new Hardcover note changes to sync.')
            : _('Hardcover synced: {{inserted}} new, {{updated}} updated, {{skipped}} unchanged', {
                inserted: result.inserted,
                updated: result.updated,
                skipped: result.skipped,
              }),
        type: result.inserted === 0 && result.updated === 0 ? 'info' : 'success',
      });
    } catch (error) {
      console.error('Hardcover notes sync failed:', error);
      eventDispatcher.dispatch('toast', {
        message: _('Hardcover notes sync failed: {{error}}', {
          error: error instanceof Error ? error.message : String(error),
        }),
        type: 'error',
      });
    }
  }, [_, bookKey, getBookData, getClient, getConfig, updateLastSyncedAt]);

  const pushProgress = useCallback(async () => {
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config || !book) return;
    if (!config.hardcoverSyncEnabled) {
      eventDispatcher.dispatch('toast', {
        message: _('Enable Hardcover sync for this book first.'),
        type: 'info',
      });
      return;
    }

    const client = await getClient();
    if (!client) {
      eventDispatcher.dispatch('toast', {
        message: _('Configure Hardcover in Settings first.'),
        type: 'info',
      });
      return;
    }

    try {
      await client.pushProgress(book, config);
      await updateLastSyncedAt(Date.now());
      eventDispatcher.dispatch('toast', {
        message: _('Reading progress synced to Hardcover'),
        type: 'success',
      });
    } catch (error) {
      console.error('Hardcover progress sync failed:', error);
      eventDispatcher.dispatch('toast', {
        message: _('Hardcover progress sync failed: {{error}}', {
          error: error instanceof Error ? error.message : String(error),
        }),
        type: 'error',
      });
    }
  }, [_, bookKey, getBookData, getClient, getConfig, updateLastSyncedAt]);

  useEffect(() => {
    const handlePushNotes = async (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      await pushNotes();
    };

    const handlePushProgress = async (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      await pushProgress();
    };

    eventDispatcher.on('hardcover-push-notes', handlePushNotes);
    eventDispatcher.on('hardcover-push-progress', handlePushProgress);

    return () => {
      eventDispatcher.off('hardcover-push-notes', handlePushNotes);
      eventDispatcher.off('hardcover-push-progress', handlePushProgress);
    };
  }, [bookKey, pushNotes, pushProgress]);

  return { pushNotes, pushProgress };
};
