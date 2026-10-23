import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookNote, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { SYNC_NOTES_INTERVAL_SEC } from '@/services/constants';
import { throttle } from '@/utils/throttle';
import { getXPointerFromCFI, getCFIFromXPointer, getCFIFromXPointerRange } from '@/utils/xcfi';
import { getIndexFromCfi } from '@/utils/cfi';
import { incomingNoteWins, nextBooknoteStamp } from '@/utils/booknoteStamp';
import { removeBookNoteOverlays } from '../utils/annotatorUtil';

export const useNotesSync = (bookKey: string) => {
  const { user } = useAuth();
  const { syncedNotes, syncNotes, lastSyncedAtNotes } = useSync(bookKey);
  const { getConfig, setConfig, getBookData } = useBookDataStore();
  const { getView, getViewsById } = useReaderStore();
  // The updatedAt of each note's oldest push not yet answered by the server.
  const pushedAtRef = useRef(new Map<string, number>());

  const config = getConfig(bookKey);

  const populateXPointersForPush = async (notes: BookNote[]): Promise<BookNote[]> => {
    const bookData = getBookData(bookKey);
    const book = bookData?.book;
    if (!book || FIXED_LAYOUT_FORMATS.has(book.format)) return notes;

    const view = getView(bookKey);
    if (!view) return notes;

    const enriched: BookNote[] = [];
    for (const note of notes) {
      // KOReader turns any pulled note with an xpointer into a highlight, so a
      // drawing never gets one; without it every plugin version skips it.
      if (note.type !== 'ink' && note.cfi && !note.xpointer0) {
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
              bookData.book?.format,
            );
            enriched.push({
              ...note,
              xpointer0: xpResult.pos0 || xpResult.xpointer,
              xpointer1: xpResult.pos1,
              // Notebook uses a fixed compatibility anchor rather than a
              // semantic annotation position. Enrich its transport metadata
              // without manufacturing a newer content revision; otherwise an
              // older client can repeatedly win LWW with unchanged Markdown.
              updatedAt: note.type === 'notebook' ? note.updatedAt : Date.now(),
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
            cfi = await getCFIFromXPointerRange(
              note.xpointer0,
              note.xpointer1,
              bookData.bookDoc ?? undefined,
            );
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
    // A note without an xpointer is pushed until it gets one; a drawing never
    // does (see populateXPointersForPush), so it goes only when it changed.
    const newNotes = bookNotes.filter(
      (note) =>
        (!note.xpointer0 && note.type !== 'ink') ||
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
            enriched.forEach((note) => {
              if (!pushedAtRef.current.has(note.id)) {
                pushedAtRef.current.set(note.id, note.updatedAt);
              }
            });
            syncNotes(enriched, book?.hash, book?.metaHash, 'both');
          });
        } else {
          syncNotes(newNotes.notes, book?.hash, book?.metaHash, 'both');
        }
      },
      SYNC_NOTES_INTERVAL_SEC * 1000,
      // A highlight made inside the interval must still go out once it ends:
      // without the trailing call it waited for the next highlight or for the
      // book to be reopened on this device (#6762).
      { emitLast: true },
    ),
    [syncNotes],
  );

  // A book's first reading position is saved after its notes load, and that
  // write keeps the same booknotes array, so re-run once it appears.
  const hasLocation = !!config?.location;
  useEffect(() => {
    if (!hasLocation || !user) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLocation, config?.booknotes, handleAutoSync]);

  useEffect(() => {
    const processNewNote = (note: BookNote) => {
      const config = getConfig(bookKey);
      const oldNotes = config?.booknotes ?? [];
      const existingNote = oldNotes.find((oldNote) => oldNote.id === note.id);
      if (existingNote) {
        const pushedAt = pushedAtRef.current.get(note.id);
        if (
          pushedAt !== undefined &&
          !note.deletedAt &&
          existingNote.updatedAt > pushedAt &&
          incomingNoteWins(existingNote, note)
        ) {
          // Changed here after it was pushed: the reply is the pushed version,
          // which the server stamps with its own clock on insert. Taking it
          // would undo what was done since, such as strokes drawn while the
          // first push of a drawing was in flight. Keep ours, stamped after
          // the reply so the next sync pushes it. A deletion may come from
          // another device, so it goes through the usual newest-wins rule.
          return {
            ...note,
            ...existingNote,
            deletedAt: existingNote.deletedAt,
            updatedAt: nextBooknoteStamp(note),
          };
        }
        if (incomingNoteWins(existingNote, note)) {
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
          if (local?.type === 'annotation' && !local.deletedAt && incomingNoteWins(local, note)) {
            getViewsById(bookKey.split('-')[0]!).forEach((v) => removeBookNoteOverlays(v, local));
            // Stamp the deletion as this device's own change so the next push
            // tombstones the duplicate row under its book hash as well.
            note.updatedAt = Date.now();
          }
        } else if (note.type === 'annotation' && note.cfi) {
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
      // Answered: later copies of these notes are ordinary changes.
      convertedNotes.forEach((note) => pushedAtRef.current.delete(note.id));
      setConfig(bookKey, { booknotes: mergedNotes });
    };
    processSyncedNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncedNotes]);
};
