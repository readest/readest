import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEnv } from '@/context/EnvContext';
import type { PositionResolver } from '@/services/bookorbit/annotationExchange';
import { BookOrbitClient } from '@/services/bookorbit/BookOrbitClient';
import { BookOrbitSyncStore } from '@/services/bookorbit/BookOrbitSyncStore';
import { runBookOrbitNotesPass } from '@/services/bookorbit/notesPass';
import { SYNC_NOTES_INTERVAL_SEC } from '@/services/constants';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { BookNote, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { getIndexFromCfi } from '@/utils/cfi';
import { eventDispatcher } from '@/utils/event';
import { throttle } from '@/utils/throttle';
import { XCFI, getCFIFromXPointer, getXPointerFromCFI } from '@/utils/xcfi';
import { useWindowActiveChanged } from './useWindowActiveChanged';

/**
 * Bidirectional highlight/bookmark sync with a BookOrbit server, mounted
 * beside useNotesSync. Positions are exchanged as KOReader xpointers, so
 * fixed-layout formats are skipped (same constraint as the koplugin path).
 */
export const useBookOrbitNotesSync = (bookKey: string) => {
  const _ = useTranslation();
  const { appService } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const { getView } = useReaderStore();

  const config = getConfig(bookKey);
  const passRunning = useRef(false);
  const unmatchedHinted = useRef(false);
  const storeRef = useRef<BookOrbitSyncStore | null>(null);
  if (!storeRef.current && appService) {
    storeRef.current = new BookOrbitSyncStore(appService);
  }

  const client = useMemo(() => {
    const bookorbit = settings.bookorbit;
    if (
      !bookorbit.enabled ||
      !bookorbit.syncNotes ||
      !bookorbit.serverUrl ||
      !bookorbit.username ||
      !bookorbit.userkey
    ) {
      return null;
    }
    return new BookOrbitClient(bookorbit);
  }, [settings]);

  const populateXPointers = useCallback(
    async (notes: BookNote[]): Promise<BookNote[]> => {
      const bookData = getBookData(bookKey);
      const view = getView(bookKey);
      if (!bookData?.bookDoc || !view) return notes;

      const enriched: BookNote[] = [];
      for (const note of notes) {
        if (note.cfi && !note.xpointer0) {
          try {
            const contents = view.renderer.getContents();
            const primaryIndex = view.renderer.primaryIndex;
            const content = contents.find((x) => x.index === primaryIndex) ?? contents[0];
            if (content) {
              const xpResult = await getXPointerFromCFI(
                note.cfi,
                content.doc,
                content.index || 0,
                bookData.bookDoc ?? undefined,
              );
              enriched.push({
                ...note,
                xpointer0: xpResult.pos0 || xpResult.xpointer,
                xpointer1: xpResult.pos1,
                updatedAt: Date.now(),
              });
              continue;
            }
          } catch {
            // Conversion failed — sync without xpointers (note is skipped).
          }
        }
        enriched.push(note);
      }
      return enriched;
    },
    [bookKey, getBookData, getView],
  );

  const resolvePosition: PositionResolver = useCallback(
    async (pos0, pos1) => {
      const bookData = getBookData(bookKey);
      const view = getView(bookKey);
      if (!bookData?.bookDoc) return null;
      try {
        let cfi: string | undefined;
        if (pos1) {
          const spineIndex = XCFI.extractSpineIndex(pos0);
          const doc = await bookData.bookDoc.sections?.[spineIndex]?.createDocument();
          if (doc) {
            const converter = new XCFI(doc, spineIndex);
            cfi = converter.xPointerToCFI(pos0, pos1);
          }
        } else {
          const contents = view?.renderer.getContents() ?? [];
          const primaryIndex = view?.renderer.primaryIndex;
          const content = contents.find((x) => x.index === primaryIndex) ?? contents[0];
          cfi = await getCFIFromXPointer(pos0, content?.doc, content?.index, bookData.bookDoc);
        }
        if (!cfi) return null;
        let page: number | undefined;
        if (view) {
          try {
            const progress = await view.getCFIProgress(cfi);
            if (progress) page = progress.location.current + 1;
          } catch {
            // Page resolution is best-effort.
          }
        }
        return { cfi, page, verified: true };
      } catch {
        return null;
      }
    },
    [bookKey, getBookData, getView],
  );

  const mergeNotes = useCallback(
    (upserts: BookNote[], deleteNoteIds: string[]) => {
      const config = getConfig(bookKey);
      if (!config) return;
      const view = getView(bookKey);
      const byId = new Map((config.booknotes ?? []).map((note) => [note.id, note]));
      const applied: BookNote[] = [];
      for (const upsert of upserts) {
        const existing = byId.get(upsert.id);
        if (existing) {
          if (existing.updatedAt <= upsert.updatedAt) {
            const merged = { ...existing, ...upsert };
            byId.set(upsert.id, merged);
            applied.push(merged);
          }
        } else {
          byId.set(upsert.id, upsert);
          applied.push(upsert);
        }
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
        if (!note.deletedAt && note.cfi && note.type === 'annotation') {
          const index = getIndexFromCfi(note.cfi);
          if (index === view?.renderer.primaryIndex) {
            view.addAnnotation(note);
          }
        }
      }
    },
    [bookKey, getConfig, setConfig, getView],
  );

  const runPass = useCallback(async () => {
    const store = storeRef.current;
    if (!client || !store) return;
    const { settings } = useSettingsStore.getState();
    const bookorbit = settings.bookorbit;
    if (!bookorbit.enabled || !bookorbit.syncNotes) return;

    const bookData = getBookData(bookKey);
    const book = bookData?.book;
    const config = getConfig(bookKey);
    if (!book || !bookData?.bookDoc || !config?.location) return;
    if (FIXED_LAYOUT_FORMATS.has(book.format)) return;
    if (passRunning.current) return;

    passRunning.current = true;
    try {
      await runBookOrbitNotesPass({
        client,
        store,
        book: {
          hash: book.hash,
          title: book.title,
          author: book.author,
          readingStatus: book.readingStatus,
          readingStatusUpdatedAt: book.readingStatusUpdatedAt,
        },
        getNotes: () => getConfig(bookKey)?.booknotes ?? [],
        mergeNotes,
        resolvePosition,
        populateXPointers,
        syncBookStates: bookorbit.syncBookStates,
        now: () => Date.now(),
        onUnmatched: () => {
          if (unmatchedHinted.current) return;
          unmatchedHinted.current = true;
          eventDispatcher.dispatch('hint', {
            bookKey,
            message: _('Book not found in the BookOrbit library'),
          });
        },
      });
    } catch (error) {
      console.warn('[BookOrbit] notes sync failed', error);
    } finally {
      passRunning.current = false;
    }
  }, [bookKey, client, getBookData, getConfig, mergeNotes, resolvePosition, populateXPointers, _]);

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
    if (!client || !config?.location) return;
    throttledPass();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, config?.location, config?.booknotes, throttledPass]);

  useWindowActiveChanged((isActive) => {
    if (!isActive) runPassRef.current();
  });
};
