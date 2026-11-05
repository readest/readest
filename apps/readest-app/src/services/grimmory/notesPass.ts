import type { BookNote, ReadingStatus } from '@/types/book';
import { resolveGrimmoryBook } from './bookMatch';
import { GrimmoryRequestError, type GrimmoryClient } from './GrimmoryClient';
import type { GrimmoryBookMatch, GrimmorySyncStore } from './GrimmorySyncStore';
import {
  annotationCreateBody,
  annotationToRemoteNote,
  annotationUpdateBody,
  bookmarkCreateBody,
  bookmarkToRemoteNote,
  bookmarkUpdateBody,
  planNotesSync,
  type GrimmoryNoteKind,
  type GrimmoryNoteLink,
  type HighlightPalette,
  type RemoteNote,
} from './notesSync';
import type { GrimmoryReadStatus } from './types';

const READ_STATUS: Record<ReadingStatus, GrimmoryReadStatus> = {
  unread: 'UNREAD',
  reading: 'READING',
  finished: 'READ',
  abandoned: 'PAUSED',
};

/** Notes that went each way in one pass. */
export interface GrimmoryPassCounts {
  pushed: number;
  pulled: number;
}

export interface GrimmoryPassDeps {
  client: Pick<
    GrimmoryClient,
    | 'listBooks'
    | 'readContent'
    | 'getAnnotations'
    | 'createAnnotation'
    | 'updateAnnotation'
    | 'deleteAnnotation'
    | 'getBookmarks'
    | 'createBookmark'
    | 'updateBookmark'
    | 'deleteBookmark'
    | 'updateReadStatus'
  >;
  store: Pick<GrimmorySyncStore, 'getBook' | 'setBook' | 'deleteBook' | 'getLinks' | 'setLinks'>;
  account: string;
  book: {
    hash: string;
    fileSize?: number;
    readingStatus?: ReadingStatus;
    readingStatusUpdatedAt?: number;
  };
  /** Highlights and bookmarks sync for reflowable books only; CFIs of a PDF differ. */
  syncNotes: boolean;
  syncBookStates: boolean;
  /** Every note of the book, tombstones included. */
  getNotes: () => BookNote[];
  /** Merge notes by id and tombstone the listed ids. */
  mergeNotes: (upserts: BookNote[], deleteNoteIds: string[]) => void;
  chapterForNote: (note: BookNote) => string | undefined;
  palette: HighlightPalette;
  now: () => number;
  newId: () => string;
  onUnmatched: () => void;
}

const isStatus = (error: unknown, status: number) =>
  error instanceof GrimmoryRequestError && error.status === status;

const syncKind = async (
  deps: GrimmoryPassDeps,
  match: GrimmoryBookMatch,
  kind: GrimmoryNoteKind,
  counts: GrimmoryPassCounts,
): Promise<void> => {
  const { client, store, account, palette } = deps;
  const { hash } = deps.book;
  const remote: RemoteNote[] =
    kind === 'annotation'
      ? (await client.getAnnotations(match.bookId)).map((a) => annotationToRemoteNote(a, palette))
      : (await client.getBookmarks(match.bookId))
          .map(bookmarkToRemoteNote)
          .filter((note): note is RemoteNote => !!note);
  const links = (await store.getLinks(account, hash)).filter((link) => link.kind === kind);
  const plan = planNotesSync({
    kind,
    notes: deps.getNotes(),
    remote,
    links,
    palette,
    now: deps.now(),
    newId: deps.newId,
  });

  if (plan.upsertLocal.length > 0 || plan.deleteLocal.length > 0) {
    deps.mergeNotes(plan.upsertLocal, plan.deleteLocal);
    counts.pulled += plan.upsertLocal.length + plan.deleteLocal.length;
  }

  // An edit stays marked as unsent (localUpdatedAt 0) until the server takes
  // it, so a pass that stops early sends it next time instead of letting the
  // server copy overwrite it.
  const pending = new Set(plan.updateRemote.map(({ note }) => note.id));
  const nextLinks: GrimmoryNoteLink[] = plan.links.map((link) =>
    pending.has(link.noteId) ? { ...link, localUpdatedAt: 0 } : link,
  );
  try {
    for (const serverId of plan.deleteRemote) {
      if (kind === 'annotation') await client.deleteAnnotation(serverId);
      else await client.deleteBookmark(serverId);
      counts.pushed++;
    }
    for (const { note, serverId } of plan.updateRemote) {
      try {
        if (kind === 'annotation') {
          await client.updateAnnotation(serverId, annotationUpdateBody(note, palette));
        } else {
          await client.updateBookmark(serverId, bookmarkUpdateBody(note));
        }
        counts.pushed++;
        const link = nextLinks.find((l) => l.noteId === note.id);
        if (link) link.localUpdatedAt = note.updatedAt;
      } catch (error) {
        if (isStatus(error, 401)) throw error;
        console.warn('[Grimmory] update failed', error);
      }
    }
    for (const note of plan.createRemote) {
      try {
        if (kind === 'annotation') {
          const body = annotationCreateBody(match.bookId, note, palette, deps.chapterForNote(note));
          const created = await client.createAnnotation(body);
          nextLinks.push({
            noteId: note.id,
            kind,
            serverId: created.id,
            localUpdatedAt: note.updatedAt,
          });
        } else {
          const created = await client.createBookmark(bookmarkCreateBody(match.bookId, note));
          // A new bookmark takes no notes, so they follow in an update.
          if (note.note) await client.updateBookmark(created.id, bookmarkUpdateBody(note));
          nextLinks.push({
            noteId: note.id,
            kind,
            serverId: created.id,
            localUpdatedAt: note.updatedAt,
          });
        }
        counts.pushed++;
      } catch (error) {
        if (isStatus(error, 401)) throw error;
        // 409: created at this CFI by another client meanwhile; the next pass
        // pairs the two. Anything else is retried by the next pass.
        if (!isStatus(error, 409)) console.warn('[Grimmory] create failed', error);
      }
    }
  } finally {
    await store.setLinks(account, hash, kind, nextLinks);
  }
};

/**
 * One Grimmory pass for an open book: find it on the server, sync its
 * highlights and bookmarks both ways, and send its reading status.
 */
export const runGrimmoryPass = async (
  deps: GrimmoryPassDeps,
  counts: GrimmoryPassCounts = { pushed: 0, pulled: 0 },
): Promise<GrimmoryPassCounts> => {
  const { client, store, account, book } = deps;
  const match = await resolveGrimmoryBook({
    client,
    store,
    account,
    hash: book.hash,
    fileSize: book.fileSize,
  });
  if (!match) {
    deps.onUnmatched();
    return counts;
  }

  try {
    if (deps.syncNotes) {
      await syncKind(deps, match, 'annotation', counts);
      await syncKind(deps, match, 'bookmark', counts);
    }
    const statusAt = book.readingStatusUpdatedAt ?? 0;
    if (deps.syncBookStates && book.readingStatus && statusAt > match.statusPushedAt) {
      await client.updateReadStatus(match.bookId, READ_STATUS[book.readingStatus]);
      await store.setBook(account, book.hash, { ...match, statusPushedAt: statusAt });
    }
  } catch (error) {
    // The book was removed from Grimmory: forget it so the next pass looks again.
    if (isStatus(error, 404)) await store.deleteBook(account, book.hash);
    throw error;
  }
  return counts;
};
