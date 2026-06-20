import { useCallback, useEffect, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { debounce } from '@/utils/debounce';
import { HardcoverClient, HardcoverSyncMapStore } from '@/services/hardcover';
import { BookNote } from '@/types/book';

// Hardcover throttles its API hard (≈1 req/1.15s), and the "currently reading"
// status + reading-session progress it tracks doesn't need second-by-second
// accuracy, so the auto-sync debounce is deliberately coarse.
const HARDCOVER_SYNC_DEBOUNCE_MS = 10000;

interface PushOptions {
  // Auto-sync runs silently (errors → console only) so we don't toast on every
  // page turn; manual menu actions stay loud.
  silent?: boolean;
}

export const useHardcoverSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();
  // Reactive page-turn signal — drives the auto-push effect below. The host
  // (Annotator) already subscribes to this, so it adds no extra renders.
  const progress = useBookProgress(bookKey);

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

  const pushNotes = useCallback(
    async (options?: PushOptions) => {
      const silent = options?.silent ?? false;
      const config = getConfig(bookKey);
      const book = getBookData(bookKey)?.book;
      if (!config || !book) return;

      const eligibleNotes = (config.booknotes ?? []).filter(
        (note: BookNote) =>
          (note.type === 'annotation' || note.type === 'excerpt') && !note.deletedAt,
      );

      if (eligibleNotes.length === 0) {
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('No annotations or excerpts to sync for this book.'),
            type: 'info',
          });
        }
        return;
      }

      const client = await getClient();
      if (!client) {
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('Configure Hardcover in Settings first.'),
            type: 'info',
          });
        }
        return;
      }

      try {
        const result = await client.syncBookNotes(book, config);

        await updateLastSyncedAt(Date.now());
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message:
              result.inserted === 0 && result.updated === 0
                ? _('No new Hardcover note changes to sync.')
                : _(
                    'Hardcover synced: {{inserted}} new, {{updated}} updated, {{skipped}} unchanged',
                    {
                      inserted: result.inserted,
                      updated: result.updated,
                      skipped: result.skipped,
                    },
                  ),
            type: result.inserted === 0 && result.updated === 0 ? 'info' : 'success',
          });
        }
      } catch (error) {
        console.error('Hardcover notes sync failed:', error);
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('Hardcover notes sync failed: {{error}}', {
              error: error instanceof Error ? error.message : String(error),
            }),
            type: 'error',
          });
        }
      }
    },
    [_, bookKey, getBookData, getClient, getConfig, updateLastSyncedAt],
  );

  const pushProgress = useCallback(
    async (options?: PushOptions) => {
      const silent = options?.silent ?? false;
      const config = getConfig(bookKey);
      const book = getBookData(bookKey)?.book;
      if (!config || !book) return;

      const client = await getClient();
      if (!client) {
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('Configure Hardcover in Settings first.'),
            type: 'info',
          });
        }
        return;
      }

      try {
        await client.pushProgress(book, config);
        await updateLastSyncedAt(Date.now());
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('Reading progress synced to Hardcover'),
            type: 'success',
          });
        }
      } catch (error) {
        console.error('Hardcover progress sync failed:', error);
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('Hardcover progress sync failed: {{error}}', {
              error: error instanceof Error ? error.message : String(error),
            }),
            type: 'error',
          });
        }
      }
    },
    [_, bookKey, getBookData, getClient, getConfig, updateLastSyncedAt],
  );

  // Debounced, silent auto-pushers. Settings are read at call time so a freshly
  // toggled Auto Sync (or a disconnect) takes effect without rebuilding these.
  const debouncedAutoPushProgress = useMemo(
    () =>
      debounce(() => {
        const { settings } = useSettingsStore.getState();
        if (!settings.hardcover?.enabled || settings.hardcover?.autoSync !== true) return;
        pushProgress({ silent: true });
      }, HARDCOVER_SYNC_DEBOUNCE_MS),
    [pushProgress],
  );

  const debouncedAutoPushNotes = useMemo(
    () =>
      debounce(() => {
        const { settings } = useSettingsStore.getState();
        if (!settings.hardcover?.enabled || settings.hardcover?.autoSync !== true) return;
        pushNotes({ silent: true });
      }, HARDCOVER_SYNC_DEBOUNCE_MS),
    [pushNotes],
  );

  // Manual "Push Progress" / "Push Notes" from BookMenu — force a sync now, with
  // toasts, regardless of the Auto Sync toggle.
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

  // Flush any pending auto-push when the book closes (ReaderContent dispatches
  // 'sync-book-progress' before teardown) or when the user taps the manual
  // cloud Sync button — so a quick close doesn't drop the pending push.
  useEffect(() => {
    const handleFlush = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      debouncedAutoPushProgress.flush();
      debouncedAutoPushNotes.flush();
    };
    eventDispatcher.on('sync-book-progress', handleFlush);
    return () => {
      eventDispatcher.off('sync-book-progress', handleFlush);
    };
  }, [bookKey, debouncedAutoPushProgress, debouncedAutoPushNotes]);

  // Cancel pending auto-pushes on unmount so they don't fire after teardown.
  useEffect(() => {
    return () => {
      debouncedAutoPushProgress.cancel();
      debouncedAutoPushNotes.cancel();
    };
  }, [debouncedAutoPushProgress, debouncedAutoPushNotes]);

  // Auto-push progress on page turns.
  useEffect(() => {
    debouncedAutoPushProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location]);

  // Auto-push notes when annotations/excerpts change.
  const config = getConfig(bookKey);
  useEffect(() => {
    debouncedAutoPushNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.booknotes]);

  return { pushNotes, pushProgress };
};
