import { describe, expect, it } from 'vitest';
import { toAnkiText, toCsv } from '@/services/vocabulary/export';
import type { VocabularyEntry } from '@/services/vocabulary/types';

const entry = (patch: Partial<VocabularyEntry> = {}): VocabularyEntry => ({
  id: 'en:serendipity',
  lang: 'en',
  key: 'serendipity',
  word: 'Serendipity',
  state: 'learning',
  hint: '意外发现',
  occurrences: [
    {
      sentence: 'It was pure serendipity that we met.',
      at: Date.UTC(2026, 9, 30),
      bookTitle: 'The Alchemist',
      bookAuthor: 'Paulo Coelho',
    },
    { sentence: 'Serendipity, again.', at: Date.UTC(2026, 9, 1), bookTitle: 'The Alchemist' },
  ],
  createdAt: Date.UTC(2026, 9, 1),
  modifiedAt: 1,
  deletedAt: null,
  ...patch,
});

describe('toAnkiText', () => {
  it('starts with the header lines Anki reads on import', () => {
    expect(toAnkiText([entry()]).split('\n').slice(0, 5)).toEqual([
      '#separator:tab',
      '#html:true',
      '#notetype:Basic',
      '#deck:Readest Vocabulary',
      '#tags column:3',
    ]);
  });

  it('puts the word and its latest sentence on the front and the hint on the back', () => {
    const [front, back, tags] = toAnkiText([entry()]).split('\n')[5]!.split('\t');
    expect(front).toBe(
      '<div style="font-size:1.6em">Serendipity</div><div>It was pure <b>serendipity</b> that we met.</div>',
    );
    expect(back).toBe('意外发现<br><small>The Alchemist — Paulo Coelho</small>');
    expect(tags).toBe('readest The_Alchemist');
  });

  it('escapes HTML and strips tabs and newlines from fields', () => {
    const line = toAnkiText([
      entry({
        word: 'a<b',
        key: 'a<b',
        hint: 'x\ty',
        occurrences: [{ sentence: 'Use a<b\nhere.', at: 1 }],
      }),
    ]).split('\n')[5]!;
    expect(line.split('\t')).toHaveLength(3);
    expect(line).toContain('a&lt;b');
    expect(line).not.toContain('a<b');
    expect(line).toContain('x y');
  });

  it('bolds only whole-word matches', () => {
    const line = toAnkiText([
      entry({
        word: 'cat',
        key: 'cat',
        occurrences: [{ sentence: 'The cat sat on a category.', at: 1 }],
      }),
    ]).split('\n')[5]!;
    expect(line).toContain('The <b>cat</b> sat on a category.');
  });
});

describe('toCsv', () => {
  it('starts with a BOM and a header row', () => {
    const csv = toCsv([entry()]);
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv.slice(1).split('\r\n')[0]).toBe(
      'word,state,hint,latest sentence,all sentences,book,author,first looked up,last looked up,lookup count',
    );
  });

  it('quotes fields holding commas, quotes or newlines', () => {
    const csv = toCsv([entry({ hint: 'say "hi", ok' })]);
    const row = csv.slice(1).split('\r\n')[1];
    expect(row).toBe(
      [
        'Serendipity',
        'learning',
        '"say ""hi"", ok"',
        'It was pure serendipity that we met.',
        '"It was pure serendipity that we met.\nSerendipity, again."',
        'The Alchemist',
        'Paulo Coelho',
        '2026-10-01',
        '2026-10-30',
        '2',
      ].join(','),
    );
  });
});
