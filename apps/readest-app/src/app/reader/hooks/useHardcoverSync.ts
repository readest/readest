import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useHardcoverSyncStore } from '@/store/hardcoverSyncStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { debounce } from '@/utils/debounce';
import {
  HardcoverClient,
  HardcoverSyncMapStore,
  HardcoverAuthError,
  HardcoverUnmatchedError,
  isHardcoverConnected,
  createHardcoverTokenStore,
} from '@/services/hardcover';
import { BookNote, HardcoverBookLink } from '@/types/book';

// The "currently reading" status + reading-session progress Hardcover tracks
// doesn't need second-by-second accuracy, so the auto-sync debounce is coarse.
const HARDCOVER_SYNC_DEBOUNCE_MS = 10000;

interface PushOptions {
  // Auto-sync runs silently (errors → console only) so we don't toast on every
  // page turn; manual menu actions stay loud.
  silent?: boolean;
}

export const useHardcoverSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getConfig, getBookData, setConfig, saveConfig } = useBookDataStore();
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

  // One client (and map store) per book, so progress and notes pushes share
  // the cached user id and note mappings; rebuilt when the token changes.
  const clientRef = useRef<{ token: string; client: HardcoverClient } | null>(null);
  const notesQueueRef = useRef<Promise<void>>(Promise.resolve());

  const getClient = useCallback(async () => {
    const { settings } = useSettingsStore.getState();
    const hardcover = settings.hardcover;
    if (!hardcover?.enabled || !isHardcoverConnected(hardcover)) {
      return null;
    }
    const token = hardcover.oauth?.accessToken ?? hardcover.accessToken;
    const appService = await envConfig.getAppService();
    if (clientRef.current?.token !== token) {
      const mapStore = new HardcoverSyncMapStore(appService);
      const tokenStore = createHardcoverTokenStore(envConfig);
      clientRef.current = { token, client: new HardcoverClient(hardcover, mapStore, tokenStore) };
    }
    return clientRef.current.client;
  }, [envConfig]);

  // Remember which Hardcover book a sync resolved to (#5846): the book menu
  // shows it, later syncs skip the title search, and a wrong match becomes
  // visible and fixable from "Link Book". Only ever fills in a missing link:
  // a push runs for seconds (Hardcover throttles hard), and a link the user
  // picked in the meantime must not be overwritten by the stale match.
  const rememberLink = useCallback(
    async (link: HardcoverBookLink) => {
      const config = getConfig(bookKey);
      if (!config || config.hardcover) return;
      const { settings } = useSettingsStore.getState();
      await saveConfig(envConfig, bookKey, { ...config, hardcover: link }, settings);
      setConfig(bookKey, { hardcover: link });
    },
    [bookKey, envConfig, getConfig, saveConfig, setConfig],
  );

  // Notes pushes run one at a time: overlapping ones would each see the other's
  // inserts as missing and duplicate journal entries.
  const pushNotes = useCallback(
    async (options?: PushOptions) => {
      const previous = notesQueueRef.current;
      let release = () => {};
      notesQueueRef.current = new Promise<void>((resolve) => (release = resolve));
      await previous;
      try {
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

        const { begin, end } = useHardcoverSyncStore.getState();
        let failure: string | null = null;
        begin(bookKey);
        try {
          const result = await client.syncBookNotes(book, config);
          await rememberLink(result.link);
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
          const message = error instanceof Error ? error.message : String(error);
          // A book Hardcover cannot sync is not a broken sync.
          if (!(error instanceof HardcoverUnmatchedError)) failure = message;
          if (!silent) {
            eventDispatcher.dispatch('toast', {
              message:
                error instanceof HardcoverAuthError
                  ? _('Authentication failed. Reconnect in Settings.')
                  : _('Hardcover notes sync failed: {{error}}', { error: message }),
              type: 'error',
            });
          }
        } finally {
          end(bookKey, failure);
        }
      } finally {
        release();
      }
    },
    [_, bookKey, getBookData, getClient, getConfig, rememberLink, updateLastSyncedAt],
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

      const { begin, end } = useHardcoverSyncStore.getState();
      let failure: string | null = null;
      begin(bookKey);
      try {
        const link = await client.pushProgress(book, config);
        await rememberLink(link);
        await updateLastSyncedAt(Date.now());
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('Reading progress synced to Hardcover'),
            type: 'success',
          });
        }
      } catch (error) {
        console.error('Hardcover progress sync failed:', error);
        const message = error instanceof Error ? error.message : String(error);
        // A book Hardcover cannot sync is not a broken sync.
        if (!(error instanceof HardcoverUnmatchedError)) failure = message;
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message:
              error instanceof HardcoverAuthError
                ? _('Authentication failed. Reconnect in Settings.')
                : _('Hardcover progress sync failed: {{error}}', { error: message }),
            type: 'error',
          });
        }
      } finally {
        end(bookKey, failure);
      }
    },
    [_, bookKey, getBookData, getClient, getConfig, rememberLink, updateLastSyncedAt],
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
      await pushNotes({ silent: event.detail.silent });
    };

    const handlePushProgress = async (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      await pushProgress({ silent: event.detail.silent });
    };

    eventDispatcher.on('hardcover-push-notes', handlePushNotes);
    eventDispatcher.on('hardcover-push-progress', handlePushProgress);

    return () => {
      eventDispatcher.off('hardcover-push-notes', handlePushNotes);
      eventDispatcher.off('hardcover-push-progress', handlePushProgress);
    };
  }, [bookKey, pushNotes, pushProgress]);

  // Flush any pending auto-push when the book closes (ReaderContent dispatches
  // 'flush-hardcover-sync' before teardown) so a quick close doesn't drop it.
  useEffect(() => {
    const handleFlush = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      debouncedAutoPushProgress.flush();
      debouncedAutoPushNotes.flush();
    };
    eventDispatcher.on('flush-hardcover-sync', handleFlush);
    return () => {
      eventDispatcher.off('flush-hardcover-sync', handleFlush);
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
