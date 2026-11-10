import { describe, expect, it } from 'vitest';
import { filterEntries, listBooks } from '@/services/vocabulary/filter';
import type { VocabularyEntry } from '@/services/vocabulary/types';

const entry = (
  key: string,
  patch: Partial<VocabularyEntry> = {},
  books: { hash: string; title: string; at: number }[] = [],
): VocabularyEntry => ({
  id: `en:${key}`,
  lang: 'en',
  key,
  word: key,
  state: 'none',
  occurrences: books.map((b) => ({
    sentence: `${key}.`,
    at: b.at,
    bookHash: b.hash,
    bookTitle: b.title,
  })),
  createdAt: 1,
  modifiedAt: 1,
  deletedAt: null,
  ...patch,
});

const dune = { hash: 'd', title: 'Dune', at: 30 };
const emma = { hash: 'e', title: 'Emma', at: 20 };
const entries = [
  entry('spice', { state: 'learning', hint: '香料' }, [dune]),
  entry('sandworm', { state: 'mastered' }, [{ ...dune, at: 10 }]),
  entry('ball', {}, [emma]),
  entry('gone', { deletedAt: 5 }, []),
];

describe('filterEntries', () => {
  it('lists live words newest first', () => {
    expect(filterEntries(entries, {}).map((e) => e.key)).toEqual(['spice', 'ball', 'sandworm']);
  });

  it('orders words added together (one Anki import) by word under the date-added sorts', () => {
    const batch = [entry('zebra'), entry('mango'), entry('apple')];
    for (const sort of ['newest', 'oldest'] as const) {
      expect(filterEntries(batch, {}, sort).map((e) => e.key)).toEqual(['apple', 'mango', 'zebra']);
    }
  });
  it('filters by state', () => {
    expect(filterEntries(entries, { state: 'learning' }).map((e) => e.key)).toEqual(['spice']);
    expect(filterEntries(entries, { state: 'none' }).map((e) => e.key)).toEqual(['ball']);
  });
  it('filters by book', () => {
    expect(filterEntries(entries, { bookHash: 'd' }).map((e) => e.key)).toEqual([
      'spice',
      'sandworm',
    ]);
  });
  it('searches the word and the hint', () => {
    expect(filterEntries(entries, { query: 'WORM' }).map((e) => e.key)).toEqual(['sandworm']);
    expect(filterEntries(entries, { query: '香' }).map((e) => e.key)).toEqual(['spice']);
  });
});

describe('listBooks', () => {
  it('lists each book with captured words once, by title', () => {
    expect(listBooks(entries)).toEqual([
      { hash: 'd', title: 'Dune' },
      { hash: 'e', title: 'Emma' },
    ]);
  });
});
