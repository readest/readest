import { useCallback, useEffect } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookNote, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { SYNC_NOTES_INTERVAL_SEC } from '@/services/constants';
import { throttle } from '@/utils/throttle';
import { getXPointerFromCFI, getCFIFromXPointer, XCFI } from '@/utils/xcfi';
import { getIndexFromCfi } from '@/utils/cfi';
import { removeBookNoteOverlays } from '../utils/annotatorUtil';
import { removeGlobalAnnotationOverlays } from '../utils/globalAnnotations';

const latestChangeAt = (note: BookNote) => Math.max(note.updatedAt, note.deletedAt ?? 0);

// Latest change wins, the same rule the server's dedupeLatest applies across
// duplicate rows, so a highlight edited after a remote deletion survives and a
// deletion made after a remote edit sticks. A tie goes to the tombstone.
const incomingWins = (existing: BookNote, incoming: BookNote) => {
  const existingAt = latestChangeAt(existing);
  const incomingAt = latestChangeAt(incoming);
  return (
    incomingAt > existingAt ||
    (incomingAt === existingAt && !!incoming.deletedAt && !existing.deletedAt)
  );
};

export const useNotesSync = (bookKey: string) => {
  const { user } = useAuth();
  const { syncedNotes, syncNotes, lastSyncedAtNotes } = useSync(bookKey);
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const { getView, getViewsById } = useReaderStore();

  const config = getConfig(bookKey);

  const populateXPointersForPush = async (notes: BookNote[]): Promise<BookNote[]> => {
    const bookData = getBookData(bookKey);
    const book = bookData?.book;
    if (!book || FIXED_LAYOUT_FORMATS.has(book.format)) return notes;

    const view = getView(bookKey);
    if (!view) return notes;

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
          // Conversion failed — push without xpointers
        }
      }
      enriched.push(note);
    }
    return enriched;
  };

  const convertXPointersOnPull = async (notes: BookNote[]): Promise<BookNote[]> => {
    const bookData = getBookData(bookKey);
    const book = bookData?.book;
    if (!book || FIXED_LAYOUT_FORMATS.has(book.format)) {
      return notes.filter((n) => n.cfi || n.deletedAt);
    }

    const view = getView(bookKey);
    const converted: BookNote[] = [];
    for (const note of notes) {
      if (note.deletedAt) {
        // A tombstone only needs its id to mark the local copy deleted; never
        // drop it because its xpointer can't be resolved to a cfi (#5818).
        converted.push(note);
      } else if (note.xpointer0 && !note.cfi) {
        try {
          let cfi: string | undefined;
          if (note.xpointer1) {
            const spineIndex = XCFI.extractSpineIndex(note.xpointer0);
            const doc = await bookData.bookDoc?.sections?.[spineIndex]?.createDocument();
            if (doc) {
              const converter = new XCFI(doc, spineIndex);
              cfi = converter.xPointerToCFI(note.xpointer0, note.xpointer1);
            }
          } else {
            const contents = view?.renderer.getContents() ?? [];
            const primaryIndex = view?.renderer.primaryIndex;
            const content = contents.find((x) => x.index === primaryIndex) ?? contents[0];
            cfi = await getCFIFromXPointer(
              note.xpointer0,
              content?.doc,
              content?.index,
              bookData.bookDoc ?? undefined,
            );
          }
          if (cfi) {
            let page = note.page;
            if (view) {
              try {
                const progress = await view.getCFIProgress(cfi);
                if (progress) {
                  page = progress.location.current + 1;
                }
              } catch {
                // Page resolution failed — keep original page
              }
            }
            converted.push({ ...note, cfi, page, updatedAt: Date.now() });
          }
        } catch {
          // Conversion failed — discard note
        }
      } else if (note.cfi) {
        converted.push(note);
      }
      // Discard notes with neither cfi nor xpointer
    }
    return converted;
  };

  const getNewNotes = useCallback(() => {
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config?.location || !book || !user) return {};

    const bookNotes = config.booknotes ?? [];
    const newNotes = bookNotes.filter(
      (note) =>
        !note.xpointer0 ||
        lastSyncedAtNotes < note.updatedAt ||
        lastSyncedAtNotes < (note.deletedAt ?? 0),
    );
    newNotes.forEach((note) => {
      note.bookHash = book.hash;
      note.metaHash = book.metaHash;
    });
    return {
      notes: newNotes,
      lastSyncedAt: lastSyncedAtNotes,
    };
  }, [user, bookKey, lastSyncedAtNotes, getConfig, getBookData]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAutoSync = useCallback(
    throttle(
      () => {
        const book = getBookData(bookKey)?.book;
        const newNotes = getNewNotes();
        if (newNotes.notes?.length) {
          populateXPointersForPush(newNotes.notes).then((enriched) => {
            syncNotes(enriched, book?.hash, book?.metaHash, 'both');
          });
        } else {
          syncNotes(newNotes.notes, book?.hash, book?.metaHash, 'both');
        }
      },
      SYNC_NOTES_INTERVAL_SEC * 1000,
      { emitLast: false },
    ),
    [syncNotes],
  );

  useEffect(() => {
    if (!config?.location || !user) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.booknotes, handleAutoSync]);

  useEffect(() => {
    const processNewNote = (note: BookNote) => {
      const config = getConfig(bookKey);
      const oldNotes = config?.booknotes ?? [];
      const existingNote = oldNotes.find((oldNote) => oldNote.id === note.id);
      if (existingNote) {
        if (incomingWins(existingNote, note)) {
          // A tombstone from KOReader carries no cfi; keep the local anchor or
          // setConfig discards the note instead of recording the deletion. The
          // winner's deletedAt is pinned either way so a newer live note does
          // not inherit a stale local tombstone through a missing key.
          return {
            ...existingNote,
            ...note,
            cfi: note.cfi || existingNote.cfi,
            deletedAt: note.deletedAt,
          };
        } else {
          // The local note wins; a losing tombstone must not leak its
          // deletedAt through a key the live note never had.
          return { ...note, ...existingNote, deletedAt: existingNote.deletedAt };
        }
      }
      return note;
    };
    const processSyncedNotes = async () => {
      if (!syncedNotes?.length || !config) return;
      const view = getView(bookKey);
      const book = getBookData(bookKey)?.book;
      const newNotes = syncedNotes.filter(
        (note) => note.bookHash === book?.hash || note.metaHash === book?.metaHash,
      );
      if (!newNotes.length) return;
      // Convert xpointer-only notes (from KOReader) to CFI
      const convertedNotes = await convertXPointersOnPull(newNotes);
      const oldNotes = config.booknotes ?? [];
      convertedNotes.forEach((note) => {
        if (note.deletedAt) {
          // Deleted on another device: clear the overlay drawn from the
          // local copy, which is the one holding the cfi it was drawn with,
          // unless the local note was edited after that deletion.
          const local = oldNotes.find((oldNote) => oldNote.id === note.id);
          if (local && !local.deletedAt && incomingWins(local, note)) {
            getViewsById(bookKey.split('-')[0]!).forEach((v) => {
              removeBookNoteOverlays(v, local);
              if (local.global) removeGlobalAnnotationOverlays(v, local);
            });
            // Stamp the deletion as this device's own change so the next push
            // tombstones the duplicate row under its book hash as well.
            note.updatedAt = Date.now();
          }
        } else if (note.cfi) {
          const index = getIndexFromCfi(note.cfi);
          if (index === view?.renderer.primaryIndex) {
            view.addAnnotation(note);
          }
        }
      });
      const mergedNotes = [
        ...oldNotes.filter((oldNote) => !convertedNotes.some((n) => n.id === oldNote.id)),
        ...convertedNotes.map(processNewNote),
      ];
      setConfig(bookKey, { booknotes: mergedNotes });
    };
    processSyncedNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedNotes]);
};
