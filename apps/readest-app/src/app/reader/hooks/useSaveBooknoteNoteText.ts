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
 * Confirms persistence before closing the editor or updating note bubbles.
 * Failed saves restore the previous stored note and keep the draft for retry.
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

        const previousBooknotes = config.booknotes ?? [];
        const result = updateBooknoteNoteText(previousBooknotes, booknoteId, noteText, Date.now());
        if (!result) throw new Error('Booknote unavailable');

        const updatedConfig = updateBooknotes(bookKey, result.booknotes);
        if (!updatedConfig) throw new Error('Booknote update failed');

        try {
          await saveConfig(envConfig, bookKey, updatedConfig, settings);
        } catch (error) {
          const latest = getConfig(bookKey)?.booknotes;
          // Restore only our optimistic edit, preserving concurrent sync/edit changes.
          if (latest?.includes(result.updatedBooknote)) {
            const previous = previousBooknotes.find(
              (note) => note.id === booknoteId && !note.deletedAt,
            )!;
            updateBooknotes(
              bookKey,
              latest.map((note) => (note === result.updatedBooknote ? previous : note)),
            );
          }
          throw error;
        }

        const transition = decideNoteBubbleTransition(
          result.previousNoteText,
          result.updatedBooknote.note,
        );
        applyNoteBubbleTransition(
          getViewsById(bookKey.split('-')[0]!),
          result.updatedBooknote,
          transition,
        );
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
