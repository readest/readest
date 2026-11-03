import { describe, it, expect } from 'vitest';
import {
  MAX_OCCURRENCES,
  addOccurrence,
  entryId,
  extractSentence,
  mergeEntries,
  normalizeWordKey,
} from '@/services/vocabulary/entry';
import type { VocabularyEntry, VocabularyOccurrence } from '@/services/vocabulary/types';

const occ = (sentence: string, at: number, extra: Partial<VocabularyOccurrence> = {}) => ({
  sentence,
  at,
  bookHash: 'h1',
  cfi: `epubcfi(/6/2!/4/${at})`,
  ...extra,
});

const entry = (patch: Partial<VocabularyEntry> = {}): VocabularyEntry => ({
  id: 'en:serendipity',
  lang: 'en',
  key: 'serendipity',
  word: 'serendipity',
  state: 'none',
  occurrences: [],
  createdAt: 1,
  modifiedAt: 1,
  deletedAt: null,
  ...patch,
});

describe('normalizeWordKey', () => {
  it('strips edge punctuation and lowercases', () => {
    expect(normalizeWordKey('“Running,”')).toBe('running');
    expect(normalizeWordKey('  Serendipity. ')).toBe('serendipity');
  });
  it('folds curly apostrophes to straight ones', () => {
    expect(normalizeWordKey('Don’t')).toBe("don't");
  });
  it('keeps CJK text and inner hyphens', () => {
    expect(normalizeWordKey('「斟酌」')).toBe('斟酌');
    expect(normalizeWordKey('well-known')).toBe('well-known');
  });
});

describe('entryId', () => {
  it('joins language and key', () => {
    expect(entryId('und', 'run')).toBe('und:run');
  });
});

describe('extractSentence', () => {
  it('cuts the surrounding text to the sentence holding the word', () => {
    expect(extractSentence('He paused. It was pure ', 'serendipity', ' that we met. Then')).toBe(
      'It was pure serendipity that we met.',
    );
  });
  it('handles CJK terminators', () => {
    expect(extractSentence('他走了。我们必须', '斟酌', '这件事！然后')).toBe(
      '我们必须斟酌这件事！',
    );
  });
  it('falls back to the word when there is no context', () => {
    expect(extractSentence('', 'word', '')).toBe('word');
  });
  it('collapses whitespace and newlines', () => {
    expect(extractSentence('Line one.\n\nThe  ', 'cat', '\n sat.')).toBe('The cat sat.');
  });
});

describe('addOccurrence', () => {
  it('puts the newest first and ignores an identical occurrence', () => {
    let e = addOccurrence(entry(), occ('A cat.', 1));
    e = addOccurrence(e, occ('B cat.', 2));
    e = addOccurrence(e, occ('B cat.', 3, { cfi: 'epubcfi(/6/2!/4/99)' }));
    expect(e.occurrences.map((o) => o.sentence)).toEqual(['B cat.', 'B cat.', 'A cat.']);
    const again = addOccurrence(e, occ('A cat.', 1));
    expect(again.occurrences).toHaveLength(3);
  });
  it(`keeps at most ${MAX_OCCURRENCES}`, () => {
    let e = entry();
    for (let i = 0; i < MAX_OCCURRENCES + 5; i++) e = addOccurrence(e, occ(`S${i}.`, i));
    expect(e.occurrences).toHaveLength(MAX_OCCURRENCES);
    expect(e.occurrences[0]!.sentence).toBe(`S${MAX_OCCURRENCES + 4}.`);
  });
});

describe('mergeEntries', () => {
  it('takes state and hint from the newer side and unions occurrences', () => {
    const a = entry({
      state: 'learning',
      hint: '意外',
      modifiedAt: 10,
      occurrences: [occ('A.', 5)],
    });
    const b = entry({ state: 'none', modifiedAt: 8, occurrences: [occ('B.', 7)] });
    const m = mergeEntries(a, b);
    expect(m.state).toBe('learning');
    expect(m.hint).toBe('意外');
    expect(m.modifiedAt).toBe(10);
    expect(m.occurrences.map((o) => o.sentence)).toEqual(['B.', 'A.']);
    expect(mergeEntries(b, a)).toEqual(m);
  });
  it('keeps a delete that is newer than every occurrence', () => {
    const deleted = entry({ deletedAt: 20, modifiedAt: 20, occurrences: [] });
    const old = entry({ state: 'learning', modifiedAt: 10, occurrences: [occ('A.', 5)] });
    const m = mergeEntries(deleted, old);
    expect(m.deletedAt).toBe(20);
    expect(m.occurrences).toEqual([]);
  });
  it('revives a deleted word looked up again after the delete', () => {
    const deleted = entry({ deletedAt: 20, modifiedAt: 20, occurrences: [] });
    // A device that missed the delete still holds the old sentence.
    const relooked = entry({
      state: 'learning',
      modifiedAt: 30,
      occurrences: [occ('New.', 30), occ('Old.', 5)],
    });
    const m = mergeEntries(deleted, relooked);
    expect(m.deletedAt).toBeNull();
    expect(m.occurrences.map((o) => o.sentence)).toEqual(['New.']);
    expect(mergeEntries(relooked, deleted)).toEqual(m);
  });
  it('revives a word looked up after the delete on a device that missed it', () => {
    // Lookups don't move modifiedAt, so the stale copy is older than the delete.
    const deleted = entry({ deletedAt: 20, modifiedAt: 20, occurrences: [] });
    const stale = entry({
      state: 'learning',
      hint: '旧',
      modifiedAt: 15,
      occurrences: [occ('New.', 30), occ('Old.', 5)],
    });
    const m = mergeEntries(deleted, stale);
    expect(m.deletedAt).toBeNull();
    expect(m.state).toBe('none');
    expect(m.hint).toBeUndefined();
    expect(m.occurrences.map((o) => o.sentence)).toEqual(['New.']);
    expect(mergeEntries(stale, deleted)).toEqual(m);
  });
});
