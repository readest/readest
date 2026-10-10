import { describe, it, expect } from 'vitest';

import { inkNoteId, loadInkEditor, withInkNotes } from '@/services/handwriting/persistence';
import { HandwritingEditor } from '@/services/handwriting/editor';
import type { InkStroke } from '@/services/handwriting/model';
import type { BookNote } from '@/types/book';

const WORDS = 'epubcfi(/6/8!/4/2/10,/1:4,/1:9)';
const OTHER = 'epubcfi(/6/8!/4/2/12,/1:0,/1:5)';
const section = (index: number) => `epubcfi(/6/${(index + 1) * 2}!)`;

const stroke = (id: string, anchor?: string): InkStroke => ({
  id,
  color: '#000',
  width: 0.004,
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
  it('writes one ink annotation per anchor, beside the other booknotes', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', WORDS));
    editor.addStroke('sec:3', stroke('b', WORDS));
    editor.addStroke('sec:3', stroke('c', OTHER));
    const notes = write([highlight], editor);

    expect(notes[0]).toBe(highlight);
    const ink = notes.filter((n) => n.type === 'ink');
    expect(ink.map((n) => n.cfi)).toEqual([WORDS, OTHER]);
    expect(ink[0]).toMatchObject({
      id: inkNoteId(WORDS),
      text: 'marked words',
      createdAt: 100,
      updatedAt: 100,
    });
    expect(ink[0]!.ink!.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('keeps one ink annotation per fixed-layout page, numbered like the page', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('page:4', stroke('a'));
    const [note] = write([], editor);
    expect(note).toMatchObject({ type: 'ink', cfi: section(4), page: 5 });
  });

  it('round-trips through the booknotes', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', WORDS));
    editor.addStroke('page:4', stroke('b'));
    const notes = JSON.parse(JSON.stringify(write([highlight], editor))) as BookNote[];

    const reflowable = loadInkEditor(notes, false);
    expect(reflowable.strokes('sec:3').map((s) => s.id)).toEqual(['a']);
    expect(reflowable.strokes('sec:3')[0]!.anchor).toBe(WORDS);
    expect(
      loadInkEditor(notes, true)
        .strokes('page:4')
        .map((s) => s.id),
    ).toEqual(['b']);
  });

  it('leaves an unchanged ink annotation as it was', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', WORDS));
    const first = write([], editor, 100);
    const again = write(first, editor, 200);
    expect(again[0]).toBe(first[0]);
  });

  it('tombstones an ink annotation whose ink was erased, so the deletion syncs', () => {
    const editor = new HandwritingEditor();
    editor.addStroke('sec:3', stroke('a', WORDS));
    const first = write([], editor, 100);
    editor.clear('sec:3');
    const [gone] = write(first, editor, 200);
    expect(gone).toMatchObject({ id: inkNoteId(WORDS), deletedAt: 200, updatedAt: 200 });
    expect(loadInkEditor([gone!], false).pageKeys()).toEqual([]);
  });

  it('ignores deleted ink annotations and other notes when loading', () => {
    const deleted: BookNote = {
      ...highlight,
      id: 'x',
      type: 'ink',
      ink: [stroke('z', WORDS)],
      deletedAt: 5,
    };
    expect(loadInkEditor([highlight, deleted], false).pageKeys()).toEqual([]);
  });
});
