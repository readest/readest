import { useCallback, useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { debounce } from '@/utils/debounce';
import { findTocItemBS } from '@/services/nav';
import { NotionClient } from '@/services/notion';
import { BookNote } from '@/types/book';

const NOTION_SYNC_DEBOUNCE_MS = 5000;

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

  const pushNotes = useCallback(
    async (all: boolean): Promise<boolean> => {
      const { settings } = useSettingsStore.getState();
      if (!settings.notion?.enabled || !settings.notion?.accessToken) return false;
      const client = new NotionClient(settings.notion);
      const book = getBookData(bookKey)?.book;
      const config = getConfig(bookKey);
      if (!book || !config?.booknotes) return false;

      const notes = all
        ? config.booknotes
        : config.booknotes.filter(
            (n) =>
              n.updatedAt > (settings.notion.lastSyncedAt ?? 0) ||
              (n.deletedAt ?? 0) > (settings.notion.lastSyncedAt ?? 0),
          );
      if (notes.length === 0) return true;

      const result = await client.pushNotes(notes, book.title, chapterForNote);
      if (result.success) {
        await updateLastSyncedAt(Date.now());
        return true;
      }
      if (!result.isNetworkError) {
        console.error('Notion sync failed:', result.message);
      }
      return false;
    },
    [bookKey, getBookData, getConfig, chapterForNote, updateLastSyncedAt],
  );

  // useMemo (not useCallback) so the debounce timer isn't reset on every render
  const debouncedPush = useMemo(
    () =>
      debounce(async () => {
        await pushNotes(false);
      }, NOTION_SYNC_DEBOUNCE_MS),
    [pushNotes],
  );

  // Manual "Push All": sends every annotation/excerpt regardless of sync timestamp
  const pushAllHighlights = useCallback(async () => {
    const { settings } = useSettingsStore.getState();
    if (!settings.notion?.enabled || !settings.notion?.accessToken) return;

    const ok = await pushNotes(true);
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
