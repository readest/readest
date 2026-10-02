import { describe, expect, it } from 'vitest';

import { findContainsMatches } from '@/utils/containsSearch';

describe('findContainsMatches', () => {
  it('preserves UTF-16 source offsets while applying case and diacritic options independently', () => {
    const text = 'Cafe\u0301 cafe CAFÉ';

    expect([
      ...findContainsMatches(text, 'cafe', { matchCase: false, matchDiacritics: false }, 'en'),
    ]).toEqual([
      { start: 0, end: 5 },
      { start: 6, end: 10 },
      { start: 11, end: 15 },
    ]);
    expect([
      ...findContainsMatches(text, 'cafe', { matchCase: false, matchDiacritics: true }, 'en'),
    ]).toEqual([{ start: 6, end: 10 }]);
    expect([
      ...findContainsMatches(text, 'Cafe', { matchCase: true, matchDiacritics: false }, 'en'),
    ]).toEqual([{ start: 0, end: 5 }]);
    expect([
      ...findContainsMatches(text, 'Cafe', { matchCase: true, matchDiacritics: true }, 'en'),
    ]).toEqual([]);
    expect([
      ...findContainsMatches(text, 'Cafe\u0301', { matchCase: true, matchDiacritics: true }, 'en'),
    ]).toEqual([{ start: 0, end: 5 }]);
  });

  it('keeps source offsets when a dropped soft hyphen offsets a lengthening fold', () => {
    // U+00AD is removed while İ lowercases to i + U+0307: same total length.
    expect([
      ...findContainsMatches(
        '\u00ADİ',
        '\u0130',
        { matchCase: false, matchDiacritics: true },
        'en',
      ),
    ]).toEqual([{ start: 1, end: 2 }]);
  });
});
