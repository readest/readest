import { describe, expect, it } from 'vitest';
import {
  decideAnnotationDraw,
  filterExportGroups,
  findAnnotationAtCfi,
  mergeRestyledAnnotation,
} from '@/app/reader/utils/annotatorUtil';
import { BookNote, BooknoteGroup } from '@/types/book';
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

describe('filterExportGroups', () => {
  const group = (booknotes: BookNote[], over: Partial<BooknoteGroup> = {}): BooknoteGroup => ({
    id: 0,
    href: 'h',
    label: 'Chapter',
    booknotes,
    ...over,
  });

  it('keeps everything when nothing is excluded', () => {
    const groups = [group([makeNote({ color: 'yellow' }), makeNote({ color: 'red' })])];
    const result = filterExportGroups(groups, { excludedColors: [], excludedStyles: [] });
    expect(result.groups[0]!.booknotes).toHaveLength(2);
    expect(result.applyColorFilter).toBe(true);
    expect(result.distinctColors).toEqual(['red', 'yellow']);
  });

  it('excludes a color and keeps the others', () => {
    const groups = [
      group([makeNote({ id: 'a', color: 'yellow' }), makeNote({ id: 'b', color: 'red' })]),
    ];
    const result = filterExportGroups(groups, { excludedColors: ['red'], excludedStyles: [] });
    expect(result.groups[0]!.booknotes.map((n) => n.id)).toEqual(['a']);
  });

  it('excludes a style and keeps the others', () => {
    const groups = [
      group([
        makeNote({ id: 'a', color: 'yellow', style: 'highlight' }),
        makeNote({ id: 'b', color: 'yellow', style: 'underline' }),
      ]),
    ];
    const result = filterExportGroups(groups, {
      excludedColors: [],
      excludedStyles: ['underline'],
    });
    expect(result.groups[0]!.booknotes.map((n) => n.id)).toEqual(['a']);
  });

  it('combines color and style filters with AND', () => {
    const groups = [
      group([
        makeNote({ id: 'a', color: 'yellow', style: 'highlight' }),
        makeNote({ id: 'b', color: 'red', style: 'highlight' }),
        makeNote({ id: 'c', color: 'yellow', style: 'underline' }),
      ]),
    ];
    const result = filterExportGroups(groups, {
      excludedColors: ['red'],
      excludedStyles: ['underline'],
    });
    expect(result.groups[0]!.booknotes.map((n) => n.id)).toEqual(['a']);
  });

  it('drops groups that become empty', () => {
    const groups = [
      group([makeNote({ id: 'a', color: 'red' })], { href: 'h1' }),
      group([makeNote({ id: 'b', color: 'yellow' })], { href: 'h2' }),
    ];
    const result = filterExportGroups(groups, { excludedColors: ['red'], excludedStyles: [] });
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.href).toBe('h2');
  });

  it('always keeps notes without a color or style (e.g. bookmarks)', () => {
    const groups = [
      group([
        makeNote({ id: 'a', color: 'yellow' }),
        makeNote({ id: 'b', color: 'red' }),
        makeNote({ id: 'bm', type: 'bookmark', color: undefined, style: undefined }),
      ]),
    ];
    const result = filterExportGroups(groups, {
      excludedColors: ['red', 'yellow'],
      excludedStyles: [],
    });
    expect(result.groups[0]!.booknotes.map((n) => n.id)).toEqual(['bm']);
  });

  it('does not apply the color filter when fewer than two colors are present', () => {
    const groups = [
      group([makeNote({ id: 'a', color: 'yellow' }), makeNote({ id: 'b', color: 'yellow' })]),
    ];
    const result = filterExportGroups(groups, { excludedColors: ['yellow'], excludedStyles: [] });
    expect(result.applyColorFilter).toBe(false);
    expect(result.groups[0]!.booknotes).toHaveLength(2);
  });

  it('orders distinct colors by default palette then custom, and styles canonically', () => {
    const groups = [
      group([
        makeNote({ color: '#abcdef', style: 'squiggly' }),
        makeNote({ color: 'blue', style: 'highlight' }),
        makeNote({ color: 'red', style: 'underline' }),
      ]),
    ];
    const result = filterExportGroups(groups, { excludedColors: [], excludedStyles: [] });
    expect(result.distinctColors).toEqual(['red', 'blue', '#abcdef']);
    expect(result.distinctStyles).toEqual(['highlight', 'underline', 'squiggly']);
  });
});
