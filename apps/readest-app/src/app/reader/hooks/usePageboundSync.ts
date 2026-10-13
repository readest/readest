import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import type { EnvConfigType } from '@/services/environment';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useBookProgress } from '@/store/readerProgressStore';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { debounce } from '@/utils/debounce';
import { PageboundClient, type PageboundSession } from '@/services/pagebound';
import type { PageboundSettings } from '@/types/settings';
import type { PageboundBookLink } from '@/types/book';

// Every push adds a reading update to the user's Pagebound stats, so auto-sync
// sends at most one a minute.
const PAGEBOUND_SYNC_DEBOUNCE_MS = 60000;

const savePagebound = async (envConfig: EnvConfigType, patch: Partial<PageboundSettings>) => {
  const { settings, setSettings, saveSettings } = useSettingsStore.getState();
  const newSettings = { ...settings, pagebound: { ...settings.pagebound, ...patch } };
  setSettings(newSettings);
  await saveSettings(envConfig, newSettings);
};

export const usePageboundSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getConfig, getBookData, setConfig, saveConfig } = useBookDataStore();
  const progress = useBookProgress(bookKey);
  // Each push can add the book to the shelf and always adds a reading update,
  // so a push requested while one is running is dropped, not doubled.
  const pushingRef = useRef(false);

  // Remember the auto-matched book so later pushes skip the search and the
  // book menu shows it; never overwrite a link the user picked meanwhile.
  const rememberLink = useCallback(
    async (link: PageboundBookLink) => {
      const config = getConfig(bookKey);
      if (!config || config.pagebound) return;
      const { settings } = useSettingsStore.getState();
      await saveConfig(envConfig, bookKey, { ...config, pagebound: link }, settings);
      setConfig(bookKey, { pagebound: link });
    },
    [bookKey, envConfig, getConfig, saveConfig, setConfig],
  );

  const pushProgress = useCallback(
    async ({ silent }: { silent: boolean }) => {
      const config = getConfig(bookKey);
      const book = getBookData(bookKey)?.book;
      const { pagebound } = useSettingsStore.getState().settings;
      if (!config || !book || !pagebound?.enabled || !pagebound.refreshToken) return;
      if (pushingRef.current) return;
      pushingRef.current = true;

      const client = new PageboundClient(pagebound, async (session: PageboundSession) => {
        // Skip a renewal that finished after the user disconnected or signed in again.
        const current = useSettingsStore.getState().settings.pagebound;
        if (!current?.enabled || current.refreshToken !== pagebound.refreshToken) return;
        await savePagebound(envConfig, session);
      });
      try {
        // Only an explicit push is shared with followers, like a manual
        // update in Pagebound; page-turn syncs stay out of their feeds.
        const link = await client.pushProgress(book, config, { broadcast: !silent });
        await rememberLink(link);
        await savePagebound(envConfig, { lastSyncedAt: Date.now() });
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('Reading progress synced to Pagebound'),
            type: 'success',
          });
        }
      } catch (error) {
        console.error('Pagebound progress sync failed:', error);
        if (!silent) {
          eventDispatcher.dispatch('toast', {
            message: _('Pagebound progress sync failed: {{error}}', {
              error: error instanceof Error ? error.message : String(error),
            }),
            type: 'error',
          });
        }
      } finally {
        pushingRef.current = false;
      }
    },
    [_, bookKey, envConfig, getBookData, getConfig, rememberLink],
  );

  const debouncedAutoPush = useMemo(
    () =>
      debounce(() => {
        if (useSettingsStore.getState().settings.pagebound?.autoSync !== true) return;
        pushProgress({ silent: true });
      }, PAGEBOUND_SYNC_DEBOUNCE_MS),
    [pushProgress],
  );

  useEffect(() => {
    const handlePush = async (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      await pushProgress({ silent: false });
    };
    // Flush a pending auto-push when the book closes or the user taps Sync.
    const handleFlush = (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      debouncedAutoPush.flush();
    };
    eventDispatcher.on('pagebound-push-progress', handlePush);
    eventDispatcher.on('sync-book-progress', handleFlush);
    return () => {
      eventDispatcher.off('pagebound-push-progress', handlePush);
      eventDispatcher.off('sync-book-progress', handleFlush);
      debouncedAutoPush.cancel();
    };
  }, [bookKey, pushProgress, debouncedAutoPush]);

  useEffect(() => {
    debouncedAutoPush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.location]);
};
