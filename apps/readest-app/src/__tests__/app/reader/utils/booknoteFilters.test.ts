import { describe, expect, it } from 'vitest';

import { collectAnnotationFacets, filterBooknotes } from '@/app/reader/utils/annotatorUtil';
import { BookNote } from '@/types/book';

let seq = 0;
const makeNote = (overrides: Partial<BookNote> = {}): BookNote => ({
  id: `note-${seq++}`,
  type: 'annotation',
  cfi: 'epubcfi(/6/4!/4/2,/1:0,/1:5)',
  text: 'highlighted passage',
  style: 'highlight',
  color: 'yellow',
  note: '',
  createdAt: 1000,
  updatedAt: 1000,
  ...overrides,
});

describe('filterBooknotes', () => {
  const highlight = makeNote({ text: 'The Cheshire Cat grinned' });
  const noted = makeNote({ text: 'down the rabbit hole', note: 'Metaphor for curiosity' });
  const tombstoned = makeNote({ text: 'gone', note: 'gone note', deletedAt: 2000 });

  it('excludes tombstoned notes for every kind', () => {
    for (const kind of ['all', 'highlights', 'notes'] as const) {
      expect(filterBooknotes([tombstoned], { kind, query: '' })).toEqual([]);
      expect(filterBooknotes([tombstoned], { kind, query: 'gone' })).toEqual([]);
    }
  });

  it('partitions by note-body emptiness', () => {
    const notes = [highlight, noted];
    expect(filterBooknotes(notes, { kind: 'all', query: '' })).toEqual([highlight, noted]);
    expect(filterBooknotes(notes, { kind: 'highlights', query: '' })).toEqual([highlight]);
    expect(filterBooknotes(notes, { kind: 'notes', query: '' })).toEqual([noted]);
  });

  it('matches the query against highlight text, case-insensitively', () => {
    expect(filterBooknotes([highlight, noted], { kind: 'all', query: 'cheshire' })).toEqual([
      highlight,
    ]);
  });

  it('matches the query against the note body, case-insensitively', () => {
    expect(filterBooknotes([highlight, noted], { kind: 'all', query: 'METAPHOR' })).toEqual([
      noted,
    ]);
  });

  it('applies kind and query together', () => {
    expect(filterBooknotes([highlight, noted], { kind: 'highlights', query: 'rabbit' })).toEqual(
      [],
    );
    expect(filterBooknotes([highlight, noted], { kind: 'notes', query: 'rabbit' })).toEqual([
      noted,
    ]);
  });

  it('treats whitespace-only queries as empty', () => {
    expect(filterBooknotes([highlight], { kind: 'all', query: '   ' })).toEqual([highlight]);
  });

  it('handles notes without text', () => {
    const noText = makeNote({ text: undefined, note: 'orphan note' });
    expect(filterBooknotes([noText], { kind: 'all', query: 'orphan' })).toEqual([noText]);
    expect(filterBooknotes([noText], { kind: 'all', query: 'nothing' })).toEqual([]);
  });

  it('drops notes whose color is excluded and keeps the rest', () => {
    const yellow = makeNote({ color: 'yellow' });
    const red = makeNote({ color: 'red' });
    expect(
      filterBooknotes([yellow, red], { kind: 'all', query: '', excludedColors: ['red'] }),
    ).toEqual([yellow]);
  });

  it('drops notes whose style is excluded and keeps the rest', () => {
    const marked = makeNote({ style: 'highlight' });
    const underlined = makeNote({ style: 'underline' });
    expect(
      filterBooknotes([marked, underlined], {
        kind: 'all',
        query: '',
        excludedStyles: ['underline'],
      }),
    ).toEqual([marked]);
  });

  it('always passes notes without the excluded attribute', () => {
    const colorless = makeNote({ color: undefined, style: undefined, note: 'plain note' });
    expect(
      filterBooknotes([colorless], {
        kind: 'all',
        query: '',
        excludedColors: ['yellow'],
        excludedStyles: ['highlight'],
      }),
    ).toEqual([colorless]);
  });

  it('combines exclusions with kind and query', () => {
    const target = makeNote({ note: 'keep me', color: 'blue', text: 'rabbit' });
    const wrongColor = makeNote({ note: 'other', color: 'red', text: 'rabbit' });
    const noNote = makeNote({ color: 'blue', text: 'rabbit' });
    expect(
      filterBooknotes([target, wrongColor, noNote], {
        kind: 'notes',
        query: 'rabbit',
        excludedColors: ['red'],
      }),
    ).toEqual([target]);
  });
});

describe('collectAnnotationFacets', () => {
  it('orders default colors palette-first, then customs in first-seen order', () => {
    const notes = [
      makeNote({ color: '#aabbcc' }),
      makeNote({ color: 'violet' }),
      makeNote({ color: 'red' }),
      makeNote({ color: '#112233' }),
    ];
    expect(collectAnnotationFacets(notes).colors).toEqual(['red', 'violet', '#aabbcc', '#112233']);
  });

  it('orders styles canonically and dedupes', () => {
    const notes = [
      makeNote({ style: 'squiggly' }),
      makeNote({ style: 'highlight' }),
      makeNote({ style: 'squiggly' }),
    ];
    expect(collectAnnotationFacets(notes).styles).toEqual(['highlight', 'squiggly']);
  });

  it('ignores tombstoned notes and missing attributes', () => {
    const notes = [
      makeNote({ color: 'green', deletedAt: 5 }),
      makeNote({ color: undefined, style: undefined }),
    ];
    expect(collectAnnotationFacets(notes)).toEqual({ colors: [], styles: [] });
  });
});
