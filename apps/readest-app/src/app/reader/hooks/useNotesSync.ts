import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/hooks/useSync';
import { BookNote, FIXED_LAYOUT_FORMATS } from '@/types/book';
import { useBookDataStore, useBookConfig } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { SYNC_NOTES_INTERVAL_SEC } from '@/services/constants';
import { throttle } from '@/utils/throttle';
import { getXPointerFromCFI, getCFIFromXPointer, getCFIFromXPointerRange } from '@/utils/xcfi';
import { getCFIFromCrossPointAnchor, getCrossPointAnchorFromCFI } from '@/utils/crosspointClipping';
import { getIndexFromCfi } from '@/utils/cfi';
import { incomingNoteWins, nextBooknoteStamp } from '@/utils/booknoteStamp';
import { removeBookNoteOverlays } from '../utils/annotatorUtil';

export const useNotesSync = (bookKey: string) => {
  const { user } = useAuth();
  const { syncedNotes, syncNotes, lastSyncedAtNotes, useSyncInited } = useSync(bookKey);
  const getConfig = useBookDataStore((s) => s.getConfig);
  const setConfig = useBookDataStore((s) => s.setConfig);
  const getBookData = useBookDataStore((s) => s.getBookData);
  const { getView, getViewsById } = useReaderStore();
  // The updatedAt of each note's oldest push not yet answered by the server.
  const pushedAtRef = useRef(new Map<string, number>());
  // The range each note last tried for an xpointer and a CrossPoint anchor this
  // session. A range gets one try, so a note that can't get one, or a server
  // that doesn't store it, doesn't push the same notes on every sync.
  const xpointerTriedRef = useRef(new Map<string, string>());
  const anchorTriedRef = useRef(new Map<string, string>());

  const config = useBookConfig(bookKey);
  // A book's first reading position is saved after its notes load, and that
  // write keeps the same booknotes array, so the push below re-runs once it
  // appears. Only whether there is one: every page turn moves it.
  const hasLocation = useBookDataStore((s) => !!s.getConfig(bookKey)?.location);

  // A note pulled from another copy of the book has no row under this one:
  // pushing it for an xpointer or an anchor would insert a row stamped now, and
  // that stale copy would outrank the real one everywhere.
  const isFromThisCopy = (note: BookNote) =>
    !note.bookHash || note.bookHash === getBookData(bookKey)?.book?.hash;

  // Fixed-layout formats have no xpointers.
  const needsXPointer = (note: BookNote) => {
    const format = getBookData(bookKey)?.book?.format;
    return (
      note.type !== 'ink' &&
      !!note.cfi &&
      !note.xpointer0 &&
      xpointerTriedRef.current.get(note.id) !== note.cfi &&
      !!format &&
      !FIXED_LAYOUT_FORMATS.has(format) &&
      !!getView(bookKey) &&
      isFromThisCopy(note)
    );
  };

  // CrossPoint reads EPUBs: their highlights carry its anchor too, the way
  // every note carries KOReader's xpointers.
  const needsCrossPointAnchor = (note: BookNote) => {
    const bookData = getBookData(bookKey);
    return (
      note.type === 'annotation' &&
      !!note.cfi &&
      !note.crosspoint &&
      !note.deletedAt &&
      anchorTriedRef.current.get(note.id) !== note.cfi &&
      bookData?.book?.format === 'EPUB' &&
      !!bookData.bookDoc &&
      isFromThisCopy(note)
    );
  };

  const populateXPointersForPush = async (notes: BookNote[]): Promise<BookNote[]> => {
    const bookData = getBookData(bookKey);
    const book = bookData?.book;
    if (!book || FIXED_LAYOUT_FORMATS.has(book.format)) return notes;

    // Not there yet on the first push of a book, which only delays the xpointers.
    const view = getView(bookKey);

    const enriched: BookNote[] = [];
    for (let note of notes) {
      // KOReader turns any pulled note with an xpointer into a highlight, so a
      // drawing never gets one; without it every plugin version skips it.
      if (view && needsXPointer(note)) {
        try {
          const contents = view.renderer.getContents();
          const primaryIndex = view.renderer.primaryIndex;
          const content = contents.find((x) => x.index === primaryIndex) ?? contents[0];
          if (content) {
            xpointerTriedRef.current.set(note.id, note.cfi);
            const xpResult = await getXPointerFromCFI(
              note.cfi,
              content.doc,
              content.index || 0,
              bookData.bookDoc ?? undefined,
              bookData.book?.format,
            );
            note = {
              ...note,
              xpointer0: xpResult.pos0 || xpResult.xpointer,
              xpointer1: xpResult.pos1,
              // Notebook uses a fixed compatibility anchor rather than a
              // semantic annotation position. Enrich its transport metadata
              // without manufacturing a newer content revision; otherwise an
              // older client can repeatedly win LWW with unchanged Markdown.
              updatedAt: note.type === 'notebook' ? note.updatedAt : Date.now(),
            };
          }
        } catch {
          // Conversion failed — push without xpointers
        }
      }
      if (needsCrossPointAnchor(note) && bookData.bookDoc) {
        anchorTriedRef.current.set(note.id, note.cfi);
        try {
          // No new stamp: an anchor isn't an edit, and a stamp would let this
          // copy beat a newer one on the server, which stores an anchor by itself.
          const crosspoint = await getCrossPointAnchorFromCFI(note.cfi, bookData.bookDoc);
          if (crosspoint) note = { ...note, crosspoint };
        } catch {
          // Conversion failed — push without it
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
      } else if ((note.xpointer0 || note.crosspoint) && !note.cfi) {
        try {
          let cfi: string | null | undefined;
          if (!note.xpointer0) {
            // A clipping a CrossPoint reader synced.
            if (bookData.bookDoc && book.format === 'EPUB') {
              cfi = await getCFIFromCrossPointAnchor(
                note.crosspoint!,
                note.text ?? '',
                bookData.bookDoc,
              );
            }
          } else if (note.xpointer1) {
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
      // Discard notes with no anchor this book can resolve
    }
    return converted;
  };

  const getNewNotes = useCallback(() => {
    const config = getConfig(bookKey);
    const book = getBookData(bookKey)?.book;
    if (!config?.location || !book || !user) return {};

    const bookNotes = config.booknotes ?? [];
    // A note without an xpointer goes until it has had its try, and a highlight
    // without a CrossPoint anchor likewise; a drawing never gets an xpointer (see
    // populateXPointersForPush), so it goes only when it changed.
    const newNotes = bookNotes.filter(
      (note) =>
        needsXPointer(note) ||
        needsCrossPointAnchor(note) ||
        lastSyncedAtNotes < note.updatedAt ||
        lastSyncedAtNotes < (note.deletedAt ?? 0),
    );
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
          // Stamped with this copy's hashes only now: until here the hash says
          // which copy a note came from, and so whether it wants back-filling.
          populateXPointersForPush(newNotes.notes).then((filled) => {
            const enriched = filled.map((note) => ({
              ...note,
              bookHash: book?.hash,
              metaHash: book?.metaHash,
            }));
            enriched.forEach((note) => {
              if (!pushedAtRef.current.has(note.id)) {
                pushedAtRef.current.set(note.id, note.updatedAt);
              }
            });
            syncNotes(enriched, book?.hash, book?.metaHash, 'both').then((pushed) => {
              if (pushed !== false) return;
              // What the tries worked out went with the push: try again.
              enriched.forEach((note) => {
                xpointerTriedRef.current.delete(note.id);
                anchorTriedRef.current.delete(note.id);
              });
            });
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

  // The first push of a book goes out before the view exists.
  const hasView = !!getView(bookKey);
  useEffect(() => {
    // Until useSync is ready its syncNotes drops the push, and the one anchor
    // try a highlight gets each session would go with it.
    if (!hasLocation || !user || !useSyncInited) return;
    handleAutoSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLocation, hasView, config?.booknotes, handleAutoSync]);

  useEffect(() => {
    // A local copy that won the merge still takes the reply's xpointers and
    // anchor for the same range, or it would look unanchored and be stamped and
    // pushed again. A local null only cleared the old range's.
    const withReplyAnchors = (merged: BookNote, reply: BookNote): BookNote => {
      if (merged.cfi !== reply.cfi) return merged;
      const { xpointer0, xpointer1, crosspoint } = reply;
      return {
        ...merged,
        ...(!merged.xpointer0 && xpointer0 ? { xpointer0, xpointer1 } : {}),
        ...(!merged.crosspoint && crosspoint ? { crosspoint } : {}),
      };
    };
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
          return withReplyAnchors(
            {
              ...note,
              ...existingNote,
              deletedAt: existingNote.deletedAt,
              updatedAt: nextBooknoteStamp(note),
            },
            note,
          );
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
          return withReplyAnchors(
            { ...note, ...existingNote, deletedAt: existingNote.deletedAt },
            note,
          );
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
