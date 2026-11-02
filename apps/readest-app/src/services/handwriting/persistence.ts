import * as CFI from 'foliate-js/epubcfi.js';
import type { BookNote } from '@/types/book';
import { HandwritingEditor } from './editor';
import type { InkPage, InkStroke } from './model';
import { fixedPageKey, parsePageKey, sectionPageKey } from './pageKey';

/**
 * Handwriting is stored as `ink` booknotes: everything drawn in one session
 * of drawing mode is one annotation, listed in the sidebar like any other.
 * Each stroke keeps its own place: its text anchor in a reflowable book, its
 * page in a fixed-layout one. The editor works on page keys in memory; these
 * convert between the two.
 */

/** The spine index a CFI points into. */
const sectionOf = (cfi: string): number | null => {
  try {
    const parts = CFI.parse(cfi);
    const index = CFI.fake.toIndex((parts.parent ?? parts).shift());
    return Number.isInteger(index) && index >= 0 ? index : null;
  } catch {
    return null;
  }
};

/** Ink as JSON with sorted keys: the server's jsonb hands strokes back in its own key order. */
const inkJson = (value: unknown) =>
  JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

export const loadInkEditor = (notes: BookNote[], fixedLayout: boolean): HandwritingEditor => {
  const pages: Record<string, InkPage> = {};
  for (const note of notes) {
    if (note.type !== 'ink' || note.deletedAt || !note.ink?.length) continue;
    for (const stroke of note.ink) {
      const index = fixedLayout
        ? (stroke.page ?? sectionOf(note.cfi))
        : sectionOf(stroke.anchor ?? note.cfi);
      if (index === null) continue;
      const key = fixedLayout ? fixedPageKey(index) : sectionPageKey(index);
      const page = (pages[key] ??= { strokes: [], updatedAt: note.updatedAt });
      page.strokes.push({ ...stroke, session: note.id });
      page.updatedAt = Math.max(page.updatedAt, note.updatedAt);
    }
  }
  return new HandwritingEditor(pages);
};

export interface InkNoteContext {
  /** The CFI of a section, for page-level (fixed layout or unanchored) ink. */
  cfiOf: (sectionIndex: number) => string;
  /** The text a drawing marks, shown in the sidebar. */
  describe: (cfi: string) => string;
  now?: number;
}

/**
 * The booknotes with the editor's ink written in: one `ink` note per drawing
 * session, placed at its first stroke, kept as is when its ink didn't change,
 * and tombstoned once its ink is gone so the deletion syncs.
 */
export const withInkNotes = (
  notes: BookNote[],
  editor: HandwritingEditor,
  { cfiOf, describe, now = Date.now() }: InkNoteContext,
): BookNote[] => {
  const sessions = new Map<string, { strokes: InkStroke[]; cfi: string; page?: number }>();
  for (const key of editor.pageKeys()) {
    const parsed = parsePageKey(key);
    if (!parsed) continue;
    const fixed = parsed.kind === 'page';
    for (const { session, page: _page, ...stroke } of editor.strokes(key)) {
      const id = session ?? `ink-${stroke.id}`;
      let group = sessions.get(id);
      if (!group) {
        const cfi = !fixed && stroke.anchor ? stroke.anchor : cfiOf(parsed.index);
        group = { strokes: [], cfi, ...(fixed ? { page: parsed.index + 1 } : {}) };
        sessions.set(id, group);
      }
      group.strokes.push(fixed ? { ...stroke, page: parsed.index } : stroke);
    }
  }

  const previous = new Map(notes.filter((n) => n.type === 'ink').map((n) => [n.id, n]));
  const result = notes.filter((n) => n.type !== 'ink');
  for (const [id, { strokes, cfi, page }] of sessions) {
    const prev = previous.get(id);
    previous.delete(id);
    if (prev && !prev.deletedAt && inkJson(prev.ink) === inkJson(strokes)) {
      result.push(prev);
      continue;
    }
    result.push({
      id,
      type: 'ink',
      cfi,
      ...(page ? { page } : {}),
      text: (prev?.cfi === cfi && prev.text) || describe(cfi),
      note: prev?.note ?? '',
      ink: strokes,
      createdAt: prev && !prev.deletedAt ? prev.createdAt : now,
      updatedAt: now,
    });
  }
  for (const gone of previous.values()) {
    result.push(gone.deletedAt ? gone : { ...gone, ink: [], deletedAt: now, updatedAt: now });
  }
  return result;
};

/**
 * The book's ink as drawn, to tell outside edits from our own. Stamps are left
 * out: sync restamps a drawing it pushed without changing its strokes, and
 * reloading for that would drop the stroke being drawn and the undo history.
 */
export const inkSignature = (notes: BookNote[] | undefined) =>
  inkJson(
    (notes ?? [])
      .filter((n) => n.type === 'ink')
      // Sync moves the notes it returns to the end of the list.
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((n) => [n.id, n.deletedAt ?? 0, n.ink]),
  );
