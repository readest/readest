import type { BookNote, HighlightColor, HighlightStyle } from '@/types/book';
import type { GrimmoryAnnotation, GrimmoryAnnotationStyle, GrimmoryBookmark } from './types';

/**
 * Two-way highlight and bookmark sync with Grimmory, planned without I/O.
 *
 * Grimmory keeps no tombstones, so a note's link to its server copy is kept
 * locally (GrimmorySyncStore): a linked note whose server copy is gone was
 * deleted on another client, and a linked note tombstoned here is deleted on
 * the server. Unlinked notes on both sides pair up by CFI — Grimmory's web
 * reader is foliate-js, so the same selection yields the same CFI.
 *
 * Grimmory's timestamps carry no time zone, so they are only compared with
 * themselves, never with Readest's clock. When both sides differ, the side
 * edited here since the last pass wins; otherwise the server's copy does.
 */

export type GrimmoryNoteKind = 'annotation' | 'bookmark';

export interface GrimmoryNoteLink {
  noteId: string;
  kind: GrimmoryNoteKind;
  serverId: number;
  /** The local note's updatedAt when the two last matched. */
  localUpdatedAt: number;
}

/** A server item in local terms, for both kinds. */
export interface RemoteNote {
  id: number;
  cfi: string;
  text: string;
  note: string;
  color?: HighlightColor;
  style?: HighlightStyle;
  chapter?: string;
  /** Epoch ms, read as UTC; only used against a local tombstone. */
  createdAt?: number;
}

export interface NotesPlan {
  createRemote: BookNote[];
  updateRemote: { note: BookNote; serverId: number }[];
  deleteRemote: number[];
  upsertLocal: BookNote[];
  deleteLocal: string[];
  /** Links that hold after this plan, before the server answers creations. */
  links: GrimmoryNoteLink[];
}

/** Palette name -> hex, e.g. { yellow: '#facc15' }. */
export type HighlightPalette = Record<string, string>;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
export const MAX_ANNOTATION_CFI = 1000;
export const MAX_BOOKMARK_CFI = 500;
const MAX_TEXT = 5000;
const MAX_ANNOTATION_NOTE = 5000;
const MAX_BOOKMARK_TITLE = 255;
const MAX_BOOKMARK_NOTES = 2000;

/** Readest color (palette name or hex) as Grimmory's #RRGGBB, if it has one. */
export const colorToGrimmory = (
  color: HighlightColor | undefined,
  palette: HighlightPalette,
): string | undefined => {
  if (!color) return undefined;
  const hex = palette[color] ?? color;
  return HEX_COLOR.test(hex) ? hex.toUpperCase() : undefined;
};

/** Grimmory's #RRGGBB as a palette name when it is one, else the hex itself. */
export const colorFromGrimmory = (
  color: string | null | undefined,
  palette: HighlightPalette,
): HighlightColor | undefined => {
  if (!color || !HEX_COLOR.test(color)) return undefined;
  const lower = color.toLowerCase();
  const name = Object.keys(palette).find((key) => palette[key]?.toLowerCase() === lower);
  return name ?? lower;
};

// Readest has no strikethrough; it reads as an underline.
export const styleFromGrimmory = (
  style: GrimmoryAnnotationStyle | null | undefined,
): HighlightStyle | undefined =>
  style === 'strikethrough' ? 'underline' : (style ?? undefined) || undefined;

/** Grimmory's zone-less datetime, read as UTC. */
export const parseGrimmoryDatetime = (value: string | null | undefined): number | undefined => {
  if (!value) return undefined;
  const ms = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(ms) ? ms : undefined;
};

export const annotationToRemoteNote = (
  annotation: GrimmoryAnnotation,
  palette: HighlightPalette,
): RemoteNote => ({
  id: annotation.id,
  cfi: annotation.cfi,
  text: annotation.text ?? '',
  note: annotation.note ?? '',
  color: colorFromGrimmory(annotation.color, palette),
  style: styleFromGrimmory(annotation.style),
  chapter: annotation.chapterTitle ?? undefined,
  createdAt: parseGrimmoryDatetime(annotation.createdAt),
});

/** Null when the bookmark has no CFI (a PDF page or an audiobook position). */
export const bookmarkToRemoteNote = (bookmark: GrimmoryBookmark): RemoteNote | null =>
  bookmark.cfi
    ? {
        id: bookmark.id,
        cfi: bookmark.cfi,
        text: bookmark.title ?? '',
        note: bookmark.notes ?? '',
        createdAt: parseGrimmoryDatetime(bookmark.createdAt),
      }
    : null;

/** Notes of this kind that Grimmory can hold. */
export const isSyncableNote = (note: BookNote, kind: GrimmoryNoteKind): boolean => {
  if (note.type !== kind || !note.cfi) return false;
  if (kind === 'bookmark') return note.cfi.length <= MAX_BOOKMARK_CFI;
  // Grimmory requires the highlighted text; handwriting has no place there.
  return !!note.text && !note.ink?.length && note.cfi.length <= MAX_ANNOTATION_CFI;
};

/** The fields both sides can edit, in local terms as they would be stored remotely. */
const editableFields = (
  kind: GrimmoryNoteKind,
  note: Pick<BookNote, 'text' | 'note' | 'color' | 'style'>,
  palette: HighlightPalette,
): string =>
  kind === 'bookmark'
    ? JSON.stringify([
        (note.text ?? '').slice(0, MAX_BOOKMARK_TITLE),
        (note.note ?? '').slice(0, MAX_BOOKMARK_NOTES),
      ])
    : JSON.stringify([
        (note.note ?? '').slice(0, MAX_ANNOTATION_NOTE),
        colorToGrimmory(note.color, palette) ?? '',
        note.style ?? 'highlight',
      ]);

const fromRemote = (
  kind: GrimmoryNoteKind,
  remote: RemoteNote,
  base: BookNote | undefined,
  id: string,
  now: number,
): BookNote => {
  if (base) {
    return kind === 'bookmark'
      ? { ...base, text: remote.text, note: remote.note, updatedAt: now }
      : {
          ...base,
          note: remote.note,
          color: remote.color ?? base.color,
          style: remote.style ?? base.style,
          updatedAt: now,
        };
  }
  return {
    id,
    type: kind,
    cfi: remote.cfi,
    text: remote.text,
    note: remote.note,
    ...(kind === 'annotation'
      ? { style: remote.style ?? 'highlight', color: remote.color ?? 'yellow' }
      : {}),
    createdAt: remote.createdAt ?? now,
    updatedAt: now,
  };
};

export const planNotesSync = (params: {
  kind: GrimmoryNoteKind;
  /** Every local note of the book, tombstones included. */
  notes: BookNote[];
  remote: RemoteNote[];
  links: GrimmoryNoteLink[];
  palette: HighlightPalette;
  now: number;
  newId: () => string;
}): NotesPlan => {
  const { kind, palette, now } = params;
  const plan: NotesPlan = {
    createRemote: [],
    updateRemote: [],
    deleteRemote: [],
    upsertLocal: [],
    deleteLocal: [],
    links: [],
  };
  const notes = params.notes.filter((note) => isSyncableNote(note, kind));
  const notesById = new Map(notes.map((note) => [note.id, note]));
  const remoteById = new Map(params.remote.map((remote) => [remote.id, remote]));
  const linkedNoteIds = new Set<string>();
  const linkedServerIds = new Set<number>();

  const reconcile = (local: BookNote, remote: RemoteNote, localChanged: boolean) => {
    if (editableFields(kind, local, palette) === editableFields(kind, remote, palette)) {
      plan.links.push({
        noteId: local.id,
        kind,
        serverId: remote.id,
        localUpdatedAt: local.updatedAt,
      });
    } else if (localChanged) {
      plan.updateRemote.push({ note: local, serverId: remote.id });
      plan.links.push({
        noteId: local.id,
        kind,
        serverId: remote.id,
        localUpdatedAt: local.updatedAt,
      });
    } else {
      plan.upsertLocal.push(fromRemote(kind, remote, local, local.id, now));
      plan.links.push({ noteId: local.id, kind, serverId: remote.id, localUpdatedAt: now });
    }
  };

  for (const link of params.links) {
    if (link.kind !== kind) continue;
    const local = notesById.get(link.noteId);
    const remote = remoteById.get(link.serverId);
    linkedNoteIds.add(link.noteId);
    if (remote) linkedServerIds.add(remote.id);
    if (!remote) {
      // Deleted on the server or another client.
      if (local && !local.deletedAt) plan.deleteLocal.push(local.id);
    } else if (local?.deletedAt) {
      plan.deleteRemote.push(remote.id);
    } else if (!local) {
      // The local copy is gone without a tombstone (a re-imported book):
      // restore it under its old id rather than delete it everywhere.
      plan.upsertLocal.push(fromRemote(kind, remote, undefined, link.noteId, now));
      plan.links.push({ noteId: link.noteId, kind, serverId: remote.id, localUpdatedAt: now });
    } else {
      reconcile(local, remote, local.updatedAt > link.localUpdatedAt);
    }
  }

  const unlinkedLocal = notes.filter((note) => !linkedNoteIds.has(note.id));
  const pairedLocal = new Set<string>();
  for (const remote of params.remote) {
    if (linkedServerIds.has(remote.id)) continue;
    const sameCfi = unlinkedLocal.filter(
      (note) => note.cfi === remote.cfi && !pairedLocal.has(note.id),
    );
    const live = sameCfi.find((note) => !note.deletedAt);
    if (live) {
      pairedLocal.add(live.id);
      // First pairing: this device's copy wins a difference.
      reconcile(live, remote, true);
      continue;
    }
    // Deleted here before it was ever linked, and not highlighted again since.
    const tombstone = sameCfi.find(
      (note) =>
        note.deletedAt && (remote.createdAt === undefined || remote.createdAt <= note.deletedAt),
    );
    if (tombstone) {
      pairedLocal.add(tombstone.id);
      plan.deleteRemote.push(remote.id);
      continue;
    }
    const note = fromRemote(kind, remote, undefined, params.newId(), now);
    plan.upsertLocal.push(note);
    plan.links.push({ noteId: note.id, kind, serverId: remote.id, localUpdatedAt: now });
  }

  for (const note of unlinkedLocal) {
    if (!note.deletedAt && !pairedLocal.has(note.id)) plan.createRemote.push(note);
  }
  return plan;
};

export const annotationCreateBody = (
  bookId: number,
  note: BookNote,
  palette: HighlightPalette,
  chapter: string | undefined,
) => ({
  bookId,
  cfi: note.cfi,
  text: (note.text ?? '').slice(0, MAX_TEXT),
  color: colorToGrimmory(note.color, palette),
  style: note.style ?? 'highlight',
  ...(note.note ? { note: note.note.slice(0, MAX_ANNOTATION_NOTE) } : {}),
  ...(chapter ? { chapterTitle: chapter.slice(0, 500) } : {}),
});

export const annotationUpdateBody = (note: BookNote, palette: HighlightPalette) => ({
  color: colorToGrimmory(note.color, palette),
  style: note.style ?? 'highlight',
  // An empty string clears the note; null would leave it unchanged.
  note: (note.note ?? '').slice(0, MAX_ANNOTATION_NOTE),
});

export const bookmarkCreateBody = (bookId: number, note: BookNote) => ({
  bookId,
  cfi: note.cfi,
  ...(note.text ? { title: note.text.slice(0, MAX_BOOKMARK_TITLE) } : {}),
});

export const bookmarkUpdateBody = (note: BookNote) => ({
  title: (note.text ?? '').slice(0, MAX_BOOKMARK_TITLE),
  notes: (note.note ?? '').slice(0, MAX_BOOKMARK_NOTES),
});
