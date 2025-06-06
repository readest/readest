import { useCallback, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookNote } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { SYNC_NOTES_INTERVAL_SEC } from '@/services/constants';
import { debounce } from '@/utils/debounce';

export const useNotesSync = (bookKey: string) => {
  const { user } = useAuth();
  const { syncedNotes, syncNotes, lastSyncedAtNotes } = useSync(bookKey);
  const { getConfig, setConfig } = useBookDataStore();

  const config = getConfig(bookKey);
  const bookHash = bookKey.split('-')[0]!;

  const getNewNotes = () => {
    const config = getConfig(bookKey);
    if (!config?.location || !user) return [];
    const bookNotes = config.booknotes ?? [];
    const newNotes = bookNotes.filter(
      (note) => lastSyncedAtNotes < note.updatedAt || lastSyncedAtNotes < (note.deletedAt ?? 0),
    );
    newNotes.forEach((note) => {
      note.bookHash = bookHash;
    });
    return newNotes;
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    debounce(() => {
      const newNotes = getNewNotes();
      syncNotes(newNotes, bookHash, 'both');
    }, SYNC_NOTES_INTERVAL_SEC * 1000),
    [lastSyncedAtNotes],
  );

  useEffect(() => {
    if (!config?.location || !user) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    const processNewNote = (note: BookNote) => {
      const config = getConfig(bookKey);
      const oldNotes = config?.booknotes ?? [];
      const existingNote = oldNotes.find((oldNote) => oldNote.id === note.id);
      if (existingNote) {
        if (
          existingNote.updatedAt < note.updatedAt ||
          (existingNote.deletedAt ?? 0) < (note.deletedAt ?? 0)
        ) {
          return { ...existingNote, ...note };
        } else {
          return { ...note, ...existingNote };
        }
      }
      return note;
    };
    if (syncedNotes?.length && config) {
      const newNotes = syncedNotes.filter((note) => note.bookHash === bookHash);
      if (!newNotes.length) return;
      const oldNotes = config.booknotes ?? [];
      const mergedNotes = [
        ...oldNotes.filter((oldNote) => !newNotes.some((newNote) => newNote.id === oldNote.id)),
        ...newNotes.map(processNewNote),
      ];
      setConfig(bookKey, { booknotes: mergedNotes });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedNotes]);
};
