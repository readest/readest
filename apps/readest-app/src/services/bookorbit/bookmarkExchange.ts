import type { BookNote } from '@/types/book';
import type { IdentityResolver, PositionResolver } from './annotationExchange';
import { bookOrbitKey, bookOrbitNoteId, formatKoDatetime } from './noteMapping';
import type {
  BookmarkAckApplied,
  BookmarkAckBook,
  BookmarkExchangeBookRequest,
  BookmarkExchangeBookResult,
  KoBookmark,
} from './types';

export interface BuiltBookmarkExchange {
  request: BookmarkExchangeBookRequest;
  keyToNote: Map<string, BookNote>;
}

const MAX_CHANGES_PER_REQUEST = 50;

const liveBookmarks = (notes: BookNote[]): BookNote[] =>
  notes.filter((note) => note.type === 'bookmark' && !note.deletedAt && note.xpointer0);

export const buildBookmarkExchangeBook = (
  hash: string,
  notes: BookNote[],
  identityOf: IdentityResolver,
  watermark: number,
  maxChanges = MAX_CHANGES_PER_REQUEST,
): BuiltBookmarkExchange => {
  const live = liveBookmarks(notes);
  const keys = [];
  const keyToNote = new Map<string, BookNote>();
  for (const note of live) {
    const dt = identityOf(note);
    const k = bookOrbitKey(dt, note.xpointer0!);
    keys.push({ k, dt });
    keyToNote.set(k, note);
  }
  const changes = live
    .filter((note) => note.createdAt > watermark || note.updatedAt > watermark)
    .slice(0, maxChanges)
    .map((note): KoBookmark => {
      const bookmark: KoBookmark = { datetime: identityOf(note), pos: note.xpointer0! };
      if (note.page != null) bookmark.pageno = note.page;
      const label = note.note || note.text;
      if (label) bookmark.note = label;
      return bookmark;
    });
  return { request: { hash, keys, keysComplete: true, changes }, keyToNote };
};

export interface BookmarkApplyPlan {
  upserts: BookNote[];
  deleteNoteIds: string[];
  ack: BookmarkAckBook;
  identities: { noteId: string; datetime: string; serverId: number }[];
}

/**
 * Applies one book's bookmark exchange result. Applied acks must carry the
 * device identity (key/datetime/pos) the note was stored under — the server
 * links its row to that identity and the next keys list must match it.
 */
export const applyBookmarkResult = async (
  bookHash: string,
  result: BookmarkExchangeBookResult,
  keyToNote: Map<string, BookNote>,
  resolvePosition: PositionResolver,
  now: number,
): Promise<BookmarkApplyPlan> => {
  const upserts: BookNote[] = [];
  const deleteNoteIds: string[] = [];
  const applied: BookmarkAckApplied[] = [];
  const identities: BookmarkApplyPlan['identities'] = [];

  for (const add of result.toApply.add) {
    const resolved = await resolvePosition(add.pos, null, add.title || null);
    if (!resolved) {
      applied.push({ serverId: add.serverId, status: 'failed' });
      continue;
    }
    const id = bookOrbitNoteId(bookHash, 'bookmark', add.pos);
    const identityDatetime = formatKoDatetime(now);
    upserts.push({
      id,
      type: 'bookmark',
      cfi: resolved.cfi,
      xpointer0: add.pos,
      text: add.title,
      note: '',
      page: resolved.page ?? add.pageno ?? undefined,
      createdAt: now,
      updatedAt: now,
    });
    applied.push({
      serverId: add.serverId,
      status: 'applied',
      key: bookOrbitKey(identityDatetime, add.pos),
      datetime: identityDatetime,
      pos: add.pos,
    });
    identities.push({ noteId: id, datetime: identityDatetime, serverId: add.serverId });
  }

  const deleted = result.toApply.delete.map((entry) => {
    const local = keyToNote.get(entry.key);
    if (local) deleteNoteIds.push(local.id);
    return { serverId: entry.serverId, status: 'applied' as const };
  });

  return {
    upserts,
    deleteNoteIds,
    ack: { hash: result.hash, applied, deleted },
    identities,
  };
};
