import { describe, expect, it } from 'vitest';
import {
  decideAnnotationDraw,
  findAnnotationAtCfi,
  mergeRestyledAnnotation,
} from '@/app/reader/utils/annotatorUtil';
import { BookNote } from '@/types/book';
import { NOTE_PREFIX } from '@/types/view';

const makeNote = (over: Partial<BookNote>): BookNote => ({
  id: 'id',
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4)',
  note: '',
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('decideAnnotationDraw', () => {
  it('returns bubble for a note-prefixed overlay value regardless of style', () => {
    expect(decideAnnotationDraw(`${NOTE_PREFIX}epubcfi(/6/4!/4)`, 'highlight')).toBe('bubble');
    expect(decideAnnotationDraw(`${NOTE_PREFIX}epubcfi(/6/4!/4)`, undefined)).toBe('bubble');
  });

  it('returns the style kind for a plain cfi overlay value', () => {
    expect(decideAnnotationDraw('epubcfi(/6/4!/4)', 'highlight')).toBe('highlight');
    expect(decideAnnotationDraw('epubcfi(/6/4!/4)', 'underline')).toBe('underline');
    expect(decideAnnotationDraw('epubcfi(/6/4!/4)', 'squiggly')).toBe('squiggly');
  });

  it('returns none when there is no style and it is not a note overlay', () => {
    expect(decideAnnotationDraw('epubcfi(/6/4!/4)', undefined)).toBe('none');
    expect(decideAnnotationDraw(undefined, undefined)).toBe('none');
  });
});

describe('findAnnotationAtCfi', () => {
  it('finds the live annotation at the cfi', () => {
    const notes = [makeNote({ id: 'a', cfi: 'X' }), makeNote({ id: 'b', cfi: 'Y' })];
    expect(findAnnotationAtCfi(notes, 'Y')).toBe(1);
  });

  it('ignores deleted annotations and non-annotation types', () => {
    const notes = [
      makeNote({ id: 'a', cfi: 'X', deletedAt: 5 }),
      makeNote({ id: 'b', cfi: 'X', type: 'bookmark' }),
    ];
    expect(findAnnotationAtCfi(notes, 'X')).toBe(-1);
  });
});

describe('mergeRestyledAnnotation', () => {
  it('keeps the existing id, note, text, createdAt, and global while taking the new style/color', () => {
    const existing = makeNote({
      id: 'a',
      style: 'highlight',
      color: 'yellow',
      note: 'hi',
      text: 'word',
      global: true,
      createdAt: 100,
    });
    const restyled = makeNote({
      id: 'tmp',
      style: 'underline',
      color: 'red',
      note: '',
      text: 'word',
      createdAt: 200,
      updatedAt: 200,
    });
    const merged = mergeRestyledAnnotation(existing, restyled);
    expect(merged.id).toBe('a');
    expect(merged.style).toBe('underline');
    expect(merged.color).toBe('red');
    expect(merged.note).toBe('hi');
    expect(merged.global).toBe(true);
    expect(merged.createdAt).toBe(100);
    expect(merged.updatedAt).toBe(200);
  });
});
