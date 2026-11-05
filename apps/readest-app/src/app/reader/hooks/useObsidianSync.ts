import { useCallback, useEffect, useMemo } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useBookDataStore } from '@/store/bookDataStore';
import { useSettingsStore } from '@/store/settingsStore';
import { findTocItemBS } from '@/services/nav';
import { syncBookToVault, toVaultHighlights } from '@/services/obsidian/vaultSync';
import type { BookNote } from '@/types/book';
import { debounce } from '@/utils/debounce';
import { eventDispatcher } from '@/utils/event';

const OBSIDIAN_SYNC_DEBOUNCE_MS = 5000;

// Two windows can have the same book open: serialize writes to its note.
const withBookLock = async (bookHash: string, task: () => Promise<void>) => {
  if (!globalThis.navigator?.locks) return task();
  return globalThis.navigator.locks.request(`readest-obsidian-sync-${bookHash}`, task);
};

/** Keeps the open book's note in the Obsidian vault folder in step with its highlights. */
export const useObsidianSync = (bookKey: string) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { getConfig, getBookData } = useBookDataStore();

  const pushNotes = useCallback(async (): Promise<boolean> => {
    const { obsidian } = useSettingsStore.getState().settings;
    const book = getBookData(bookKey)?.book;
    const config = getConfig(bookKey);
    const notes = config?.booknotes;
    if (!obsidian?.enabled || !obsidian.folder || !book || !notes) return false;
    const toc = getBookData(bookKey)?.bookDoc?.toc ?? [];
    const chapterForNote = (note: BookNote) => findTocItemBS(toc, note.cfi)?.label ?? null;
    try {
      const appService = await envConfig.getAppService();
      await withBookLock(book.hash, () =>
        syncBookToVault(
          appService,
          obsidian.folder,
          book,
          config.progress,
          toVaultHighlights(book.hash, notes, chapterForNote),
        ),
      );
      return true;
    } catch (error) {
      console.error('Obsidian sync failed:', error);
      return false;
    }
  }, [bookKey, envConfig, getBookData, getConfig]);

  const debouncedPush = useMemo(
    () =>
      debounce(async () => {
        await pushNotes();
      }, OBSIDIAN_SYNC_DEBOUNCE_MS),
    [pushNotes],
  );

  useEffect(() => () => debouncedPush.cancel(), [debouncedPush]);

  useEffect(() => {
    const handleFlush = async (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      debouncedPush.cancel();
      await pushNotes();
    };
    const handlePushAll = async (event: CustomEvent) => {
      if (event.detail.bookKey !== bookKey) return;
      debouncedPush.cancel();
      const ok = await pushNotes();
      eventDispatcher.dispatch('toast', {
        message: ok ? _('Notes synced to Obsidian') : _('Obsidian sync failed'),
        type: ok ? 'success' : 'error',
      });
    };
    eventDispatcher.on('flush-obsidian-sync', handleFlush);
    eventDispatcher.on('obsidian-push-all', handlePushAll);
    return () => {
      eventDispatcher.off('flush-obsidian-sync', handleFlush);
      eventDispatcher.off('obsidian-push-all', handlePushAll);
    };
  }, [_, bookKey, debouncedPush, pushNotes]);

  // Opening a book also syncs it, so highlights made before the integration
  // was turned on reach the vault too.
  const booknotes = getConfig(bookKey)?.booknotes;
  useEffect(() => {
    debouncedPush();
  }, [booknotes, debouncedPush]);
};
