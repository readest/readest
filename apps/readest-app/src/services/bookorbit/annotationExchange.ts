import type { BookNote } from '@/types/book';
import {
  bookOrbitKey,
  bookOrbitNoteId,
  colorForKoColor,
  noteToKoAnnotation,
  parseKoDatetime,
  styleForDrawer,
} from './noteMapping';
import type {
  ExchangeAckApplied,
  ExchangeAckBook,
  ExchangeBookRequest,
  ExchangeBookResult,
  KoAnnotation,
} from './types';

/** Returns the KOReader identity datetime for a note. */
export type IdentityResolver = (note: BookNote) => string;

export interface BuiltExchange {
  request: ExchangeBookRequest;
  keyToNote: Map<string, BookNote>;
}

const MAX_CHANGES_PER_REQUEST = 50;

const liveAnnotations = (notes: BookNote[]): BookNote[] =>
  notes.filter((note) => note.type === 'annotation' && !note.deletedAt && note.xpointer0);

/**
 * Builds one book's exchange request: the complete identity key list of live
 * annotations (tombstones are omitted so the server detects device deletions)
 * plus the changes that crossed the watermark since the last successful pass.
 */
export const buildAnnotationExchangeBook = (
  hash: string,
  notes: BookNote[],
  identityOf: IdentityResolver,
  watermark: number,
  maxChanges = MAX_CHANGES_PER_REQUEST,
): BuiltExchange => {
  const live = liveAnnotations(notes);
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
    .map((note) => noteToKoAnnotation(note, identityOf(note)))
    .filter((annotation): annotation is KoAnnotation => annotation !== null);
  return { request: { hash, keys, keysComplete: true, changes }, keyToNote };
};

export interface ResolvedPosition {
  cfi: string;
  page?: number;
  /** True when the resolved range's text matches the server's text (or there is nothing to compare). */
  verified: boolean;
  correctedPos0?: string;
  correctedPos1?: string;
}

export type PositionResolver = (
  pos0: string,
  pos1: string | null,
  text: string | null,
) => Promise<ResolvedPosition | null>;

export interface AnnotationApplyPlan {
  /** Pulled adds and edits, ready to merge into booknotes by id. */
  upserts: BookNote[];
  /** Local note ids to tombstone. */
  deleteNoteIds: string[];
  ack: ExchangeAckBook;
  identities: { noteId: string; datetime: string; serverId: number }[];
}

/**
 * Turns one book's exchange result into local note mutations and the ack the
 * server needs. Pure aside from the injected position resolver.
 */
export const applyAnnotationResult = async (
  bookHash: string,
  result: ExchangeBookResult,
  keyToNote: Map<string, BookNote>,
  resolvePosition: PositionResolver,
  now: number,
): Promise<AnnotationApplyPlan> => {
  const upserts: BookNote[] = [];
  const deleteNoteIds: string[] = [];
  const applied: ExchangeAckApplied[] = [];
  const identities: AnnotationApplyPlan['identities'] = [];

  for (const add of result.toApply.add) {
    const resolved = await resolvePosition(add.pos0, add.pos1, add.text || null);
    if (!resolved) {
      applied.push({ serverId: add.serverId, version: add.version, status: 'failed' });
      continue;
    }
    const id = bookOrbitNoteId(bookHash, 'annotation', add.pos0, add.pos1 ?? undefined);
    upserts.push({
      id,
      type: 'annotation',
      cfi: resolved.cfi,
      xpointer0: add.pos0,
      xpointer1: add.pos1 ?? undefined,
      text: add.text,
      note: add.note ?? '',
      style: styleForDrawer(add.drawer),
      color: colorForKoColor(add.color),
      page: resolved.page,
      createdAt: parseKoDatetime(add.datetime),
      updatedAt: now,
    });
    const ack: ExchangeAckApplied = {
      serverId: add.serverId,
      version: add.version,
      status: 'applied',
      verified: resolved.verified,
    };
    if (resolved.correctedPos0) {
      ack.corrected = true;
      ack.pos0 = resolved.correctedPos0;
      if (resolved.correctedPos1) ack.pos1 = resolved.correctedPos1;
    }
    applied.push(ack);
    identities.push({ noteId: id, datetime: add.datetime, serverId: add.serverId });
  }

  for (const edit of result.toApply.edit) {
    const local = keyToNote.get(edit.key);
    if (!local) {
      applied.push({ serverId: edit.serverId, version: edit.version, status: 'failed' });
      continue;
    }
    upserts.push({
      ...local,
      style: styleForDrawer(edit.drawer),
      color: colorForKoColor(edit.color) ?? local.color,
      text: edit.text || local.text,
      note: edit.note ?? '',
      updatedAt: now,
    });
    applied.push({ serverId: edit.serverId, version: edit.version, status: 'applied' });
  }

  const deleted = result.toApply.delete.map((entry) => {
    const local = keyToNote.get(entry.key);
    if (local) deleteNoteIds.push(local.id);
    // Nothing to delete locally still satisfies the server's intent.
    return { serverId: entry.serverId, status: 'applied' as const };
  });

  return {
    upserts,
    deleteNoteIds,
    ack: { hash: result.hash, applied, deleted },
    identities,
  };
};
