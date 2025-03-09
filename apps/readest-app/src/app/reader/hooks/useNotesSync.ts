import { useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookNote } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { SYNC_NOTES_INTERVAL_SEC } from '@/services/constants';

export const useNotesSync = (bookKey: string) => {
  const { user } = useAuth();
  const { syncedNotes, syncNotes, lastSyncedAtNotes } = useSync(bookKey);
  const { getConfig, setConfig } = useBookDataStore();

  const config = getConfig(bookKey);
  const bookHash = bookKey.split('-')[0]!;

  const lastSyncTime = useRef<number>(0);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getNewNotes = () => {
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

  useEffect(() => {
    if (!config?.location || !user) return;
    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTime.current;
    if (timeSinceLastSync > SYNC_NOTES_INTERVAL_SEC * 1000) {
      lastSyncTime.current = now;
      const newNotes = getNewNotes();
      syncNotes(newNotes, bookHash, 'both');
    } else {
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
      syncTimeoutRef.current = setTimeout(
        () => {
          lastSyncTime.current = Date.now();
          const newNotes = getNewNotes();
          syncNotes(newNotes, bookHash, 'both');
          syncTimeoutRef.current = null;
        },
        SYNC_NOTES_INTERVAL_SEC * 1000 - timeSinceLastSync,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    const processNewNote = (note: BookNote) => {
      const oldNotes = config?.booknotes ?? [];
      const existingNote = oldNotes.find((oldNote) => oldNote.id === note.id);
      if (existingNote) {
        if (existingNote.updatedAt < note.updatedAt) {
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
