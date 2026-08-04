import type { BookNote, ReadingStatus } from '@/types/book';
import {
  applyAnnotationResult,
  buildAnnotationExchangeBook,
  type PositionResolver,
} from './annotationExchange';
import { applyBookmarkResult, buildBookmarkExchangeBook } from './bookmarkExchange';
import type { BookOrbitClient } from './BookOrbitClient';
import type { BookOrbitNoteIdentity, BookOrbitWatermarkKind } from './BookOrbitSyncStore';
import { formatKoDate, formatKoDatetime, readingStatusToBookOrbit } from './noteMapping';
import type { ExchangeKey, KoAnnotation, KoBookmark } from './types';

const MAX_CHANGES_PER_REQUEST = 50;

export interface NotesSyncStore {
  getIdentities(bookHash: string): Promise<Map<string, BookOrbitNoteIdentity>>;
  setIdentity(bookHash: string, noteId: string, identity: BookOrbitNoteIdentity): Promise<void>;
  getWatermark(bookHash: string, kind: BookOrbitWatermarkKind): Promise<number>;
  setWatermark(bookHash: string, kind: BookOrbitWatermarkKind, value: number): Promise<void>;
  flush(): Promise<void>;
}

export interface NotesPassBook {
  hash: string;
  title: string;
  author?: string;
  readingStatus?: ReadingStatus;
  readingStatusUpdatedAt?: number;
}

export interface NotesPassDeps {
  client: Pick<
    BookOrbitClient,
    | 'getVersion'
    | 'matchCheck'
    | 'exchangeAnnotations'
    | 'ackAnnotations'
    | 'exchangeBookmarks'
    | 'ackBookmarks'
    | 'uploadBookStates'
  >;
  store: NotesSyncStore;
  book: NotesPassBook;
  /** Current booknotes of the book, tombstones included. */
  getNotes: () => BookNote[];
  /** Merge pulled/edited notes by id and tombstone the listed note ids. */
  mergeNotes: (upserts: BookNote[], deleteNoteIds: string[]) => void;
  resolvePosition: PositionResolver;
  /** Fill xpointer0/1 from cfi for the given notes (returns the enriched notes). */
  populateXPointers: (notes: BookNote[]) => Promise<BookNote[]>;
  syncBookStates: boolean;
  now: () => number;
  /** One-time hint that the book is not matched on the BookOrbit server. */
  onUnmatched: () => void;
}

const chunkChanges = <T>(changes: T[]): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < changes.length; i += MAX_CHANGES_PER_REQUEST) {
    chunks.push(changes.slice(i, i + MAX_CHANGES_PER_REQUEST));
  }
  if (chunks.length === 0) chunks.push([]);
  return chunks;
};

interface ExchangePhase<TChange> {
  kind: BookOrbitWatermarkKind;
  keys: ExchangeKey[];
  changes: TChange[];
  keyToNote: Map<string, BookNote>;
  exchange: (request: {
    hash: string;
    keys: ExchangeKey[];
    keysComplete: boolean;
    changes: TChange[];
  }) => Promise<{ more: boolean; unmatched: boolean } | null>;
}

/**
 * One bidirectional sync pass for the open book against a BookOrbit server:
 * match-check, annotation exchange (+ack), bookmark exchange when the server
 * supports it, and a book-state push. Watermarks only advance after a phase
 * completes, so a failed pass repeats its changes next time.
 */
export const runBookOrbitNotesPass = async (deps: NotesPassDeps): Promise<void> => {
  const { client, store, book } = deps;
  const hash = book.hash;

  const matchResult = await client.matchCheck([{ hash, title: book.title, authors: book.author }]);
  if (!matchResult.matches.some((match) => match.hash === hash)) {
    deps.onUnmatched();
    return;
  }

  // Notes created in Readest carry only a CFI until a sync path needs the
  // KOReader position; fill the cache before building keys. The enriched
  // notes are overlaid locally so this pass doesn't depend on the merge
  // having landed in the store yet.
  let notes = deps.getNotes();
  const needsPointers = notes.filter((note) => !note.deletedAt && note.cfi && !note.xpointer0);
  if (needsPointers.length > 0) {
    const enriched = await deps.populateXPointers(needsPointers);
    deps.mergeNotes(enriched, []);
    const enrichedById = new Map(enriched.map((note) => [note.id, note]));
    notes = notes.map((note) => enrichedById.get(note.id) ?? note);
  }

  const identities = await store.getIdentities(hash);
  const identityOf = (note: BookNote): string =>
    identities.get(note.id)?.datetime ?? formatKoDatetime(note.createdAt);

  const runPhase = async <TChange extends KoAnnotation | KoBookmark>(
    phase: ExchangePhase<TChange>,
  ): Promise<void> => {
    const passStart = deps.now();
    let unmatched = false;
    let more = false;

    const chunks = chunkChanges(phase.changes);
    for (let i = 0; i < chunks.length; i++) {
      const outcome = await phase.exchange({
        hash,
        keys: i === 0 ? phase.keys : [],
        keysComplete: i === 0,
        changes: chunks[i]!,
      });
      if (!outcome) {
        unmatched = true;
        break;
      }
      more = outcome.more;
    }
    while (!unmatched && more) {
      const outcome = await phase.exchange({ hash, keys: [], keysComplete: false, changes: [] });
      if (!outcome) break;
      more = outcome.more;
    }
    if (unmatched) {
      deps.onUnmatched();
      return;
    }
    await store.setWatermark(hash, phase.kind, passStart);
    await store.flush();
  };

  // Annotations.
  {
    const { request, keyToNote } = buildAnnotationExchangeBook(
      hash,
      notes,
      identityOf,
      await store.getWatermark(hash, 'annotations'),
      Number.MAX_SAFE_INTEGER,
    );
    await runPhase<KoAnnotation>({
      kind: 'annotations',
      keys: request.keys,
      changes: request.changes,
      keyToNote,
      exchange: async (chunkRequest) => {
        const response = await client.exchangeAnnotations([chunkRequest]);
        if (response.unmatched.includes(hash)) return null;
        const result = response.results.find((entry) => entry.hash === hash);
        if (!result) return { more: false, unmatched: false };
        const plan = await applyAnnotationResult(
          hash,
          result,
          keyToNote,
          deps.resolvePosition,
          deps.now(),
        );
        if (plan.upserts.length > 0 || plan.deleteNoteIds.length > 0) {
          deps.mergeNotes(plan.upserts, plan.deleteNoteIds);
        }
        if (plan.ack.applied.length > 0 || plan.ack.deleted.length > 0) {
          await client.ackAnnotations([plan.ack]);
        }
        for (const identity of plan.identities) {
          await store.setIdentity(hash, identity.noteId, {
            datetime: identity.datetime,
            serverId: identity.serverId,
          });
          identities.set(identity.noteId, {
            datetime: identity.datetime,
            serverId: identity.serverId,
          });
        }
        return { more: result.more, unmatched: false };
      },
    });
  }

  // Bookmarks, only against servers that advertise the capability.
  const capabilities = await client
    .getVersion()
    .then((version) => version.capabilities)
    .catch((): string[] => []);
  if (capabilities.includes('bookmarkSync')) {
    const { request, keyToNote } = buildBookmarkExchangeBook(
      hash,
      notes,
      identityOf,
      await store.getWatermark(hash, 'bookmarks'),
      Number.MAX_SAFE_INTEGER,
    );
    await runPhase<KoBookmark>({
      kind: 'bookmarks',
      keys: request.keys,
      changes: request.changes,
      keyToNote,
      exchange: async (chunkRequest) => {
        const response = await client.exchangeBookmarks([chunkRequest]);
        if (response.unmatched.includes(hash)) return null;
        const result = response.results.find((entry) => entry.hash === hash);
        if (!result) return { more: false, unmatched: false };
        const plan = await applyBookmarkResult(
          hash,
          result,
          keyToNote,
          deps.resolvePosition,
          deps.now(),
        );
        if (plan.upserts.length > 0 || plan.deleteNoteIds.length > 0) {
          deps.mergeNotes(plan.upserts, plan.deleteNoteIds);
        }
        if (plan.ack.applied.length > 0 || plan.ack.deleted.length > 0) {
          await client.ackBookmarks([plan.ack]);
        }
        for (const identity of plan.identities) {
          await store.setIdentity(hash, identity.noteId, {
            datetime: identity.datetime,
            serverId: identity.serverId,
          });
          identities.set(identity.noteId, {
            datetime: identity.datetime,
            serverId: identity.serverId,
          });
        }
        return { more: result.more, unmatched: false };
      },
    });
  }

  if (deps.syncBookStates) {
    const status = readingStatusToBookOrbit(book.readingStatus);
    if (status) {
      try {
        await client.uploadBookStates([
          {
            hash,
            status,
            statusModified: formatKoDate(book.readingStatusUpdatedAt ?? deps.now()),
          },
        ]);
      } catch (error) {
        console.warn('[BookOrbit] book-states push failed', error);
      }
    }
  }
};
