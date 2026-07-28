import { describe, expect, it } from 'vitest';

import { findFuzzyMatches } from '@/utils/fuzzySearch';

const matches = (text: string, query: string, options = {}) =>
  findFuzzyMatches(text, query, {
    matchCase: false,
    matchDiacritics: false,
    ...options,
  });

describe('findFuzzyMatches', () => {
  it('accepts bounded dense typo matches and rejects sparse or over-budget candidates', () => {
    const text = 'schema then schema';
    expect(matches(text, 'shcema').map(({ start, end }) => text.slice(start, end))).toEqual([
      'schema',
      'schema',
    ]);
    expect(matches('UserAuthController', 'UserController')).toHaveLength(1);
    expect(matches('s---c---h---e---m---a', 'schema')).toEqual([]);
    expect(matches('only ema remains', 'schema')).toEqual([]);
    expect(matches('ac', 'ab')).toEqual([]);
    expect(matches('ac', 'abc')).toHaveLength(1);
    expect(matches('abxyef', 'abcdef')).toHaveLength(1);
    expect(matches('abxyzf', 'abcdef')).toEqual([]);
    expect(matches('anything', '   ')).toEqual([]);
  });

  it('honors case and diacritics while reporting original UTF-16 ranges and runs', () => {
    expect(matches('Schema', 'schema')).toHaveLength(1);
    expect(matches('Schema', 'schema', { matchCase: true })).toEqual([]);
    expect(matches('café', 'cafe')).toHaveLength(1);
    expect(matches('café', 'cafe', { matchDiacritics: true })).toEqual([]);
    expect(matches('cafe\u0301', 'café', { matchDiacritics: true })).toHaveLength(1);
    const [result] = matches('x😀-b-y', '😀by');

    expect(result).toMatchObject({
      start: 1,
      end: 7,
      runs: [
        { start: 1, end: 3 },
        { start: 4, end: 5 },
        { start: 6, end: 7 },
      ],
    });
  });
});
