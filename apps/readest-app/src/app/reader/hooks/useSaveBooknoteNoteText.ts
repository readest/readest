import { useCallback } from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { updateBooknoteNoteText } from '@/utils/updateBooknoteNoteText';
import { applyNoteBubbleTransition, decideNoteBubbleTransition } from '../utils/annotatorUtil';

/**
 * Persists an inline edit to a booknote's `note` text. Writes the updated
 * booknotes to the store first; only once that write succeeds does it
 * redraw the note-bubble overlay on every rendered view and save the config
 * to disk/cloud, so a failed store update never leaves a stale bubble on
 * screen or persists a config the store itself rejected.
 *
 * Shared by every inline note editor (`BooknoteItem`, and later
 * `AnnotationNotes`) so this persistence/view-update wiring lives in one place.
 */
export function useSaveBooknoteNoteText(bookKey: string) {
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig, updateBooknotes } = useBookDataStore();
  const { getViewsById } = useReaderStore();

  return useCallback(
    (booknoteId: string, noteText: string) => {
      const config = getConfig(bookKey);
      if (!config) return;

      const result = updateBooknoteNoteText(
        config.booknotes ?? [],
        booknoteId,
        noteText,
        Date.now(),
      );
      if (!result) return;

      const updatedConfig = updateBooknotes(bookKey, result.booknotes);
      if (!updatedConfig) return;

      const transition = decideNoteBubbleTransition(
        result.previousNoteText,
        result.updatedBooknote.note,
      );
      applyNoteBubbleTransition(
        getViewsById(bookKey.split('-')[0]!),
        result.updatedBooknote,
        transition,
      );
      saveConfig(envConfig, bookKey, updatedConfig, settings);
    },
    [bookKey, envConfig, settings, getConfig, saveConfig, updateBooknotes, getViewsById],
  );
}
