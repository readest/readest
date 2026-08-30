import { useCallback, useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { debounce } from '@/utils/debounce';
import { findTocItemBS } from '@/services/nav';
import { NotionClient, NotionSyncStore } from '@/services/notion';
import { BookNote } from '@/types/book';

const NOTION_SYNC_DEBOUNCE_MS = 5000;
const NOTION_SYNC_LOCK = 'readest-notion-sync';
let syncQueue: Promise<boolean> = Promise.resolve(true);

const withCrossWindowLock = async (task: () => Promise<boolean>): Promise<boolean> => {
  if (!globalThis.navigator?.locks) return task();
  return globalThis.navigator.locks.request(NOTION_SYNC_LOCK, task);
};

const enqueueSync = (task: () => Promise<boolean>): Promise<boolean> => {
  const next = syncQueue
    .catch(() => false)
    .then(() => withCrossWindowLock(task))
    .catch((error) => {
      console.error('Notion sync failed:', error);
      return false;
    });
  syncQueue = next;
  return next;
};

export const useNotionSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();

  const updateLastSyncedAt = useCallback(
    async (timestamp: number) => {
      const { settings, setSettings, saveSettings } = useSettingsStore.getState();
      const newSettings = {
        ...settings,
        notion: { ...settings.notion, lastSyncedAt: timestamp },
      };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [envConfig],
  );

  // Resolve a note's chapter label from the book's table of contents.
  const chapterForNote = useCallback(
    (note: BookNote): string | null => {
      const bookDoc = getBookData(bookKey)?.bookDoc;
      const toc = bookDoc?.toc ?? [];
      return findTocItemBS(toc, note.cfi)?.label ?? null;
    },
    [bookKey, getBookData],
  );

  const pushNotes = useCallback(async (): Promise<boolean> => {
    return enqueueSync(async () => {
      // Read all inputs only after earlier pushes settle. An edit made during
      // an upload then becomes the next queued payload instead of being hidden
      // by a completion-time global cursor.
      const { settings } = useSettingsStore.getState();
      if (
        !settings.notion?.enabled ||
        !settings.notion?.accessToken ||
        !settings.notion?.databaseId
      ) {
        return false;
      }
      const bookData = getBookData(bookKey);
      const config = getConfig(bookKey);
      if (!bookData?.book || !config?.booknotes) return false;
      if (config.booknotes.length === 0) return true;

      const appService = await envConfig.getAppService();
      const syncStore = new NotionSyncStore(appService);
      try {
        const client = new NotionClient(settings.notion, syncStore);
        const result = await client.syncBookNotes(
          bookData.book.hash,
          bookData.book.title,
          config.booknotes,
          chapterForNote,
        );
        if (result.success) {
          await updateLastSyncedAt(Date.now());
          return true;
        }
        if (!result.isNetworkError) console.error('Notion sync failed:', result.message);
        return false;
      } finally {
        await syncStore.close();
      }
    });
  }, [bookKey, getBookData, getConfig, chapterForNote, updateLastSyncedAt, envConfig]);

  // useMemo (not useCallback) so the debounce timer isn't reset on every render
  const debouncedPush = useMemo(
    () =>
      debounce(async () => {
        await pushNotes();
      }, NOTION_SYNC_DEBOUNCE_MS),
    [pushNotes],
  );

  // Manual push uses the same per-note idempotent engine as auto-sync.
  const pushAllHighlights = useCallback(async () => {
    const { settings } = useSettingsStore.getState();
    if (
      !settings.notion?.enabled ||
      !settings.notion?.accessToken ||
      !settings.notion?.databaseId
    ) {
      return;
    }

    const ok = await pushNotes();
    if (ok) {
      eventDispatcher.dispatch('toast', {
        message: _('Notes synced to Notion'),
        type: 'success',
      });
    } else {
      eventDispatcher.dispatch('toast', {
        message: _('Notion sync failed'),
        type: 'error',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushNotes]);

  // ReaderContent awaits this before teardown. Flush the last edit now so
  // unmount cleanup cannot discard a pending debounce timer.
  useEffect(() => {
    const handleFlush = async (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      debouncedPush.cancel();
      await pushNotes();
    };
    eventDispatcher.on('flush-notion-sync', handleFlush);
    return () => {
      eventDispatcher.off('flush-notion-sync', handleFlush);
    };
  }, [bookKey, debouncedPush, pushNotes]);

  // Cancel any pending debounced sync on unmount to avoid background requests
  useEffect(() => {
    return () => {
      debouncedPush.cancel();
    };
  }, [debouncedPush]);

  // Listen for manual push-all events dispatched from BookMenu
  useEffect(() => {
    const handlePushAll = async (e: CustomEvent) => {
      if (e.detail.bookKey !== bookKey) return;
      await pushAllHighlights();
    };
    eventDispatcher.on('notion-push-all', handlePushAll);
    return () => {
      eventDispatcher.off('notion-push-all', handlePushAll);
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
