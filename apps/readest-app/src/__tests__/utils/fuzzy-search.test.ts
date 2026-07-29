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

  it('bounds result collection and rejects pathological query lengths', () => {
    expect(
      findFuzzyMatches(
        'a'.repeat(1_000),
        'a',
        {
          matchCase: false,
          matchDiacritics: false,
        },
        25,
      ),
    ).toHaveLength(25);
    const state: { truncated?: boolean } = {};
    expect(
      findFuzzyMatches(
        'a'.repeat(100_000),
        'aaa',
        { matchCase: false, matchDiacritics: false },
        500,
        state,
      ),
    ).toHaveLength(500);
    expect(state.truncated).toBe(true);
    expect(() => matches('text', 'a'.repeat(257))).toThrowError(
      'Fuzzy search query cannot exceed 256 characters',
    );
  });
});
