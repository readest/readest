import { describe, expect, it } from 'vitest';

import { findFuzzyMatches } from '@/utils/fuzzySearch';

const matches = (text: string, query: string, options = {}) =>
  findFuzzyMatches(text, query, {
    matchCase: false,
    matchDiacritics: false,
    ...options,
  });

describe('findFuzzyMatches', () => {
  it('finds exact and transposed text in source order', () => {
    const text = 'schema then schema';
    const result = matches(text, 'shcema');

    expect(result.map(({ start, end }) => text.slice(start, end))).toEqual(['schema', 'schema']);
  });

  it('matches dense subsequences while rejecting sparse noise', () => {
    expect(matches('UserAuthController', 'UserController')).toHaveLength(1);
    expect(matches('s---c---h---e---m---a', 'schema')).toEqual([]);
    expect(matches('only ema remains', 'schema')).toEqual([]);
  });

  it('uses the FFF typo budget based on query length', () => {
    expect(matches('ac', 'ab')).toEqual([]);
    expect(matches('ac', 'abc')).toHaveLength(1);
    expect(matches('abxyef', 'abcdef')).toHaveLength(1);
    expect(matches('abxyzf', 'abcdef')).toEqual([]);
  });

  it('honors case and diacritic options', () => {
    expect(matches('Schema', 'schema')).toHaveLength(1);
    expect(matches('Schema', 'schema', { matchCase: true })).toEqual([]);
    expect(matches('café', 'cafe')).toHaveLength(1);
    expect(matches('café', 'cafe', { matchDiacritics: true })).toEqual([]);
    expect(matches('cafe\u0301', 'café', { matchDiacritics: true })).toHaveLength(1);
  });

  it('reports original UTF-16 offsets and contiguous highlight runs', () => {
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

  it('returns no match for a blank query and resolves overlaps deterministically', () => {
    expect(matches('anything', '   ')).toEqual([]);
    expect(matches('schema schema', 'schema').map(({ start }) => start)).toEqual([0, 7]);
  });
});
