import { useCallback, useEffect, useMemo, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { useEnv } from '@/context/EnvContext';
import { HIGHLIGHT_COLOR_HEX, SYNC_NOTES_INTERVAL_SEC } from '@/services/constants';
import { GrimmoryClient, grimmoryAccountKey } from '@/services/grimmory/GrimmoryClient';
import { GrimmorySyncStore } from '@/services/grimmory/GrimmorySyncStore';
import { runGrimmoryPass } from '@/services/grimmory/notesPass';
import { recordFlow } from '@/services/sync/dataFlow/log';
import { findTocItemBS } from '@/services/nav';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { BookNote, FIXED_LAYOUT_FORMATS } from '@/types/book';
import type { GrimmorySettings } from '@/types/settings';
import { getIndexFromCfi } from '@/utils/cfi';
import { eventDispatcher } from '@/utils/event';
import { throttle } from '@/utils/throttle';
import { useWindowActiveChanged } from './useWindowActiveChanged';

/**
 * The pass also runs for reading statistics alone: it is what finds the open
 * book on the server, and sessions go only to books found there.
 */
export const isPassEnabled = (grimmory: GrimmorySettings) =>
  grimmory.enabled &&
  !!grimmory.serverUrl &&
  !!grimmory.username &&
  !!grimmory.password &&
  (grimmory.syncNotes || grimmory.syncBookStates || grimmory.syncStats);

/**
 * Per-book Grimmory pass, mounted beside useNotesSync: finds the book on the
 * server, syncs highlights, notes and bookmarks both ways, and sends the
 * reading status. Highlights are exchanged as EPUB CFIs, so fixed-layout
 * books send their status only.
 */
export const useGrimmoryNotesSync = (bookKey: string) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const { getView } = useReaderStore();

  const config = getConfig(bookKey);
  const passRunning = useRef(false);
  const unmatchedHinted = useRef(false);

  const grimmory = settings.grimmory;
  const target = useMemo(() => {
    if (!appService || !isPassEnabled(grimmory)) return null;
    return {
      client: new GrimmoryClient(grimmory),
      store: new GrimmorySyncStore(appService),
      account: grimmoryAccountKey(grimmory),
    };
  }, [appService, grimmory]);

  const mergeNotes = useCallback(
    (upserts: BookNote[], deleteNoteIds: string[]) => {
      const config = getConfig(bookKey);
      if (!config) return;
      const view = getView(bookKey);
      const byId = new Map((config.booknotes ?? []).map((note) => [note.id, note]));
      const applied: BookNote[] = [];
      for (const upsert of upserts) {
        const existing = byId.get(upsert.id);
        if (existing && existing.updatedAt > upsert.updatedAt) continue;
        const merged = existing ? { ...existing, ...upsert } : upsert;
        byId.set(upsert.id, merged);
        applied.push(merged);
      }
      const now = Date.now();
      for (const noteId of deleteNoteIds) {
        const existing = byId.get(noteId);
        if (existing && !existing.deletedAt) {
          const removed = { ...existing, deletedAt: now, updatedAt: now };
          byId.set(noteId, removed);
          if (removed.cfi) view?.addAnnotation(removed, true);
        }
      }
      setConfig(bookKey, { booknotes: Array.from(byId.values()) });
      for (const note of applied) {
        if (note.type !== 'annotation' || note.deletedAt || !note.cfi) continue;
        if (getIndexFromCfi(note.cfi) !== view?.renderer.primaryIndex) continue;
        // Redraw it, so an edited color or style shows.
        view.addAnnotation(note, true);
        view.addAnnotation(note);
      }
    },
    [bookKey, getConfig, setConfig, getView],
  );

  const runPass = useCallback(async () => {
    if (!target || passRunning.current) return;
    const { settings } = useSettingsStore.getState();
    const grimmory = settings.grimmory;
    if (!isPassEnabled(grimmory)) return;

    const bookData = getBookData(bookKey);
    const book = bookData?.book;
    if (!book || !bookData?.bookDoc || !getConfig(bookKey)?.location) return;

    passRunning.current = true;
    const notes = { connector: 'grimmory', kind: 'notes', bookTitle: book.title } as const;
    try {
      const { pushed, pulled } = await runGrimmoryPass({
        ...target,
        book: {
          hash: book.hash,
          fileSize: bookData.file?.size,
          readingStatus: book.readingStatus,
          readingStatusUpdatedAt: book.readingStatusUpdatedAt,
        },
        syncNotes: grimmory.syncNotes && !FIXED_LAYOUT_FORMATS.has(book.format),
        syncBookStates: grimmory.syncBookStates,
        getNotes: () => getConfig(bookKey)?.booknotes ?? [],
        mergeNotes,
        chapterForNote: (note) => findTocItemBS(bookData.bookDoc?.toc ?? [], note.cfi)?.label,
        palette: { ...HIGHLIGHT_COLOR_HEX, ...settings.globalReadSettings.customHighlightColors },
        now: () => Date.now(),
        newId: uuidv4,
        onUnmatched: () => {
          if (unmatchedHinted.current) return;
          unmatchedHinted.current = true;
          eventDispatcher.dispatch('toast', {
            type: 'warning',
            timeout: 8000,
            message: _('Book not found in Grimmory. Add the same file to Grimmory to sync it.'),
          });
        },
      });
      recordFlow({ ...notes, direction: 'push', count: pushed });
      recordFlow({ ...notes, direction: 'pull', count: pulled });
    } catch (error) {
      console.warn('[Grimmory] sync failed', error);
      recordFlow({
        ...notes,
        direction: 'push',
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      passRunning.current = false;
    }
  }, [bookKey, target, getBookData, getConfig, mergeNotes, _]);

  const runPassRef = useRef(runPass);
  useEffect(() => {
    runPassRef.current = runPass;
  }, [runPass]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const throttledPass = useCallback(
    throttle(() => runPassRef.current(), SYNC_NOTES_INTERVAL_SEC * 1000, { emitLast: false }),
    [],
  );

  useEffect(() => {
    if (!target || !config?.location) return;
    throttledPass();
  }, [target, config?.location, config?.booknotes, throttledPass]);

  // The reader's Sync row and closing the book.
  useEffect(() => {
    const handleSync = (event: CustomEvent) => {
      if (event.detail.bookKey === bookKey) runPassRef.current();
    };
    eventDispatcher.on('sync-book-progress', handleSync);
    return () => eventDispatcher.off('sync-book-progress', handleSync);
  }, [bookKey]);

  useWindowActiveChanged((isActive) => {
    if (!isActive) runPassRef.current();
  });
};
