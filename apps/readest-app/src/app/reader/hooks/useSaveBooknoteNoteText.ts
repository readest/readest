import { useCallback, useRef } from 'react';
import { useTranslation } from '@/hooks/useTranslation';
import { eventDispatcher } from '@/utils/event';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { updateBooknoteNoteText } from '@/utils/updateBooknoteNoteText';
import { applyNoteBubbleTransition, decideNoteBubbleTransition } from '../utils/annotatorUtil';

/**
 * Updates the store and note bubbles, then confirms persistence before the
 * editor can close. Failed saves leave the draft available for retry.
 */
export function useSaveBooknoteNoteText(bookKey: string) {
  const _ = useTranslation();
  const savingRef = useRef(false);
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getViewsById } = useReaderStore();

  return useCallback(
    async (booknoteId: string, noteText: string): Promise<boolean> => {
      if (savingRef.current) return false;
      savingRef.current = true;
      try {
        const config = getConfig(bookKey);
        if (!config) throw new Error('Book config unavailable');

        const result = updateBooknoteNoteText(
          config.booknotes ?? [],
          booknoteId,
          noteText,
          Date.now(),
        );
        if (!result) throw new Error('Booknote unavailable');

        const updatedConfig = updateBooknotes(bookKey, result.booknotes);
        if (!updatedConfig) throw new Error('Booknote update failed');

        const transition = decideNoteBubbleTransition(
          result.previousNoteText,
          result.updatedBooknote.note,
        );
        applyNoteBubbleTransition(
          getViewsById(bookKey.split('-')[0]!),
          result.updatedBooknote,
          transition,
        );
        await saveConfig(envConfig, bookKey, updatedConfig, settings);
        return true;
      } catch {
        eventDispatcher.dispatch('toast', {
          type: 'error',
          message: _('Failed to save note. Please try again.'),
        });
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [bookKey, envConfig, settings, getConfig, saveConfig, updateBooknotes, getViewsById, _],
  );
}
