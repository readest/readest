import * as CFI from 'foliate-js/epubcfi.js';
import { md5 } from '@/utils/md5';
import type { BookNote } from '@/types/book';
import { HandwritingEditor } from './editor';
import type { InkPage, InkStroke } from './model';
import { fixedPageKey, parsePageKey, sectionPageKey } from './pageKey';

/**
 * Handwriting is stored as `ink` booknotes, so each drawing is an annotation
 * like any other: listed in the sidebar, navigable, deletable, synced. A
 * reflowable book gets one note per anchor (the content a drawing marks); a
 * fixed-layout book one note per page. The editor works on page keys in
 * memory; these convert between the two.
 */

export const inkNoteId = (cfi: string) => `ink-${md5(cfi).slice(0, 16)}`;

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

export const loadInkEditor = (notes: BookNote[], fixedLayout: boolean): HandwritingEditor => {
  const pages: Record<string, InkPage> = {};
  for (const note of notes) {
    if (note.type !== 'ink' || note.deletedAt || !note.ink?.length) continue;
    const index = sectionOf(note.cfi);
    if (index === null) continue;
    const key = fixedLayout ? fixedPageKey(index) : sectionPageKey(index);
    const page = (pages[key] ??= { strokes: [], updatedAt: note.updatedAt });
    page.strokes.push(...note.ink);
    page.updatedAt = Math.max(page.updatedAt, note.updatedAt);
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
 * The booknotes with the editor's ink written in: one `ink` note per anchor
 * or page, kept as is when its ink didn't change, and tombstoned once its
 * ink is gone so the deletion syncs.
 */
export const withInkNotes = (
  notes: BookNote[],
  editor: HandwritingEditor,
  { cfiOf, describe, now = Date.now() }: InkNoteContext,
): BookNote[] => {
  const groups = new Map<string, { strokes: InkStroke[]; page?: number }>();
  for (const key of editor.pageKeys()) {
    const parsed = parsePageKey(key);
    if (!parsed) continue;
    for (const stroke of editor.strokes(key)) {
      const pinned = parsed.kind === 'section' && stroke.anchor;
      const cfi = pinned ? stroke.anchor! : cfiOf(parsed.index);
      const group = groups.get(cfi) ?? { strokes: [] };
      if (parsed.kind === 'page') group.page = parsed.index + 1;
      group.strokes.push(stroke);
      groups.set(cfi, group);
    }
  }

  const previous = new Map(notes.filter((n) => n.type === 'ink').map((n) => [n.id, n]));
  const result = notes.filter((n) => n.type !== 'ink');
  for (const [cfi, { strokes, page }] of groups) {
    const id = inkNoteId(cfi);
    const prev = previous.get(id);
    previous.delete(id);
    if (prev && !prev.deletedAt && JSON.stringify(prev.ink) === JSON.stringify(strokes)) {
      result.push(prev);
      continue;
    }
    result.push({
      id,
      type: 'ink',
      cfi,
      ...(page ? { page } : {}),
      text: prev?.text || describe(cfi),
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
