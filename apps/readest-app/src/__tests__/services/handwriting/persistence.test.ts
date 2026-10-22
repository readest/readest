import { describe, it, expect } from 'vitest';

import { inkSignature, loadInkEditor, withInkNotes } from '@/services/handwriting/persistence';
import { HandwritingEditor } from '@/services/handwriting/editor';
import type { InkStroke } from '@/services/handwriting/model';
import type { BookNote } from '@/types/book';

const WORDS = 'epubcfi(/6/8!/4/2/10,/1:4,/1:9)';
const OTHER = 'epubcfi(/6/8!/4/2/12,/1:0,/1:5)';
const NEXT_CHAPTER = 'epubcfi(/6/10!/4/2/2,/1:0,/1:5)';
const section = (index: number) => `epubcfi(/6/${(index + 1) * 2}!)`;

const stroke = (id: string, session: string, anchor?: string): InkStroke => ({
  id,
  color: '#000',
  width: 0.004,
  session,
  ...(anchor ? { anchor, shape: 'box' as const } : {}),
  points: [
    [0.1, 0.1],
    [0.2, 0.2],
  ],
});

const highlight: BookNote = {
  id: 'h1',
  type: 'annotation',
  cfi: WORDS,
  text: 'words',
  style: 'highlight',
  color: 'yellow',
  note: '',
  createdAt: 1,
  updatedAt: 1,
};

const write = (notes: BookNote[], editor: HandwritingEditor, now = 100) =>
  withInkNotes(notes, editor, { cfiOf: section, describe: () => 'marked words', now });

describe('ink notes', () => {
  it('makes one annotation of everything drawn in a session, beside the other booknotes', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', 'ink-s1', WORDS));
    editor.addStroke('sec:3', stroke('b', 'ink-s1', OTHER));
    editor.addStroke('sec:4', stroke('c', 'ink-s1', NEXT_CHAPTER));
    const notes = write([highlight], editor);

    expect(notes[0]).toBe(highlight);
    const ink = notes.filter((n) => n.type === 'ink');
    expect(ink).toHaveLength(1);
    expect(ink[0]).toMatchObject({
      id: 'ink-s1',
      cfi: WORDS,
      text: 'marked words',
      createdAt: 100,
      updatedAt: 100,
    });
    expect(ink[0]!.ink!.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    // The session tag is how the editor groups strokes; it isn't stored.
    expect(ink[0]!.ink!.every((s) => s.session === undefined)).toBe(true);
  });

  it('keeps separate sessions as separate annotations', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', 'ink-s1', WORDS));
    editor.addStroke('sec:3', stroke('b', 'ink-s2', OTHER));
    expect(write([], editor).map((n) => n.id)).toEqual(['ink-s1', 'ink-s2']);
  });

  it('numbers a fixed-layout drawing by its page and remembers each stroke page', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('page:4', stroke('a', 'ink-s1'));
    editor.addStroke('page:6', stroke('b', 'ink-s1'));
    const [note] = write([], editor);
    expect(note).toMatchObject({ type: 'ink', cfi: section(4), page: 5 });
    expect(note!.ink!.map((s) => s.page)).toEqual([4, 6]);
  });

  it('round-trips through the booknotes', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', 'ink-s1', WORDS));
    editor.addStroke('sec:4', stroke('b', 'ink-s1', NEXT_CHAPTER));
    const notes = JSON.parse(JSON.stringify(write([highlight], editor))) as BookNote[];

    const reloaded = loadInkEditor(notes, false);
    expect(reloaded.strokes('sec:3').map((s) => s.id)).toEqual(['a']);
    expect(reloaded.strokes('sec:4').map((s) => s.id)).toEqual(['b']);
    expect(reloaded.strokes('sec:3')[0]).toMatchObject({ anchor: WORDS, session: 'ink-s1' });
    // Saving the reloaded editor changes nothing.
    expect(write(notes, reloaded, 200)).toEqual(notes);
  });

  it('round-trips fixed-layout pages', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('page:4', stroke('a', 'ink-s1'));
    editor.addStroke('page:6', stroke('b', 'ink-s1'));
    const notes = JSON.parse(JSON.stringify(write([], editor))) as BookNote[];
    const reloaded = loadInkEditor(notes, true);
    expect(reloaded.strokes('page:4').map((s) => s.id)).toEqual(['a']);
    expect(reloaded.strokes('page:6').map((s) => s.id)).toEqual(['b']);
  });

  it('updates the annotation when one of its strokes is erased', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', 'ink-s1', WORDS));
    editor.addStroke('sec:3', stroke('b', 'ink-s1', OTHER));
    const first = write([], editor, 100);
    editor.erase('sec:3', [[0.1, 0.1]], 0.01, (s) => (s.id === 'a' ? [s.points] : null));
    const [note] = write(first, editor, 200);
    expect(note).toMatchObject({ id: 'ink-s1', updatedAt: 200, createdAt: 100 });
    expect(note!.ink!.map((s) => s.id)).toEqual(['b']);
  });

  it('tombstones the annotation once all its ink is gone, so the deletion syncs', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', 'ink-s1', WORDS));
    const first = write([], editor, 100);
    editor.clear('sec:3');
    const [gone] = write(first, editor, 200);
    expect(gone).toMatchObject({ id: 'ink-s1', deletedAt: 200, updatedAt: 200 });
    expect(loadInkEditor([gone!], false).pageKeys()).toEqual([]);
  });

  it('ignores deleted ink annotations and other notes when loading', () => {
    const deleted: BookNote = {
      ...highlight,
      id: 'x',
      type: 'ink',
      ink: [stroke('z', 'x', WORDS)],
      deletedAt: 5,
    };
    expect(loadInkEditor([highlight, deleted], false).pageKeys()).toEqual([]);
  });
});

// Postgres jsonb stores object keys shortest first.
const asJsonb = (value: object) =>
  Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.length - b.length || (a < b ? -1 : 1)),
  ) as InkStroke;

describe('synced ink', () => {
  it('keeps a synced drawing as is when sync returned its strokes with keys reordered', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', 'ink-s1', WORDS));
    const [pushed] = write([], editor, 100);
    const synced = { ...pushed!, updatedAt: 500, ink: pushed!.ink!.map(asJsonb) };
    // Drawing elsewhere must not restamp it, or it would win over a peer's edit.
    editor.addStroke('sec:4', stroke('b', 'ink-s2', NEXT_CHAPTER));
    const notes = write([synced], editor, 600);
    expect(notes.find((n) => n.id === 'ink-s1')).toBe(synced);
  });
});

describe('inkSignature', () => {
  const editor = new HandwritingEditor();
  editor.addStroke('sec:3', stroke('a', 'ink-s1', WORDS));
  const notes = write([highlight], editor, 100);
  const drawing = notes.find((n) => n.type === 'ink')!;
  const others = notes.filter((n) => n.type !== 'ink');

  it('stays the same when sync only restamps a drawing', () => {
    expect(inkSignature([...others, { ...drawing, updatedAt: 500 }])).toBe(inkSignature(notes));
  });

  it('stays the same when sync returns the strokes with their keys reordered', () => {
    const synced = { ...drawing, updatedAt: 500, ink: drawing.ink!.map(asJsonb) };
    expect(JSON.stringify(synced.ink)).not.toBe(JSON.stringify(drawing.ink));
    expect(inkSignature([...others, synced])).toBe(inkSignature(notes));
  });

  it('ignores the other booknotes', () => {
    expect(inkSignature([drawing])).toBe(inkSignature(notes));
  });

  it('stays the same when sync moves the drawings it returned to the end', () => {
    const other = { ...drawing, id: 'ink-s2' };
    expect(inkSignature([other, drawing])).toBe(inkSignature([drawing, other]));
  });

  it('changes when a drawing gains or loses strokes', () => {
    const more = { ...drawing, ink: [...drawing.ink!, stroke('b', 'ink-s1', WORDS)] };
    expect(inkSignature([more])).not.toBe(inkSignature(notes));
    expect(inkSignature([{ ...drawing, ink: [] }])).not.toBe(inkSignature(notes));
  });

  it('changes when a drawing is deleted or another one arrives', () => {
    expect(inkSignature([{ ...drawing, deletedAt: 300 }])).not.toBe(inkSignature(notes));
    expect(inkSignature([drawing, { ...drawing, id: 'ink-s2' }])).not.toBe(inkSignature(notes));
  });
});
