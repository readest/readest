import { describe, expect, it } from 'vitest';

import { findContainsMatches } from '@/utils/containsSearch';

describe('findContainsMatches', () => {
  it('matches case and diacritic variants while preserving source offsets', () => {
    const text = 'Café cafe CAFÉ';

    expect([
      ...findContainsMatches(text, 'cafe', { matchCase: false, matchDiacritics: false }, 'en'),
    ]).toEqual([
      { start: 0, end: 4 },
      { start: 5, end: 9 },
      { start: 10, end: 14 },
    ]);
  });

  it('respects case and diacritic options independently', () => {
    const text = 'Café cafe CAFÉ';

    expect([
      ...findContainsMatches(text, 'cafe', { matchCase: false, matchDiacritics: true }, 'en'),
    ]).toEqual([{ start: 5, end: 9 }]);
    expect([
      ...findContainsMatches(text, 'Cafe', { matchCase: true, matchDiacritics: false }, 'en'),
    ]).toEqual([{ start: 0, end: 4 }]);
  });
});
