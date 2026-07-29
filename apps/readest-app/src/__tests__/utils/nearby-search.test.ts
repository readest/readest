import { describe, expect, it } from 'vitest';

import { findNearbyMatches } from '@/utils/nearbySearch';

const options = {
  locale: 'en',
  matchCase: false,
  matchDiacritics: false,
  nearbyWords: 10,
};

describe('findNearbyMatches', () => {
  it('finds ordered or reversed non-overlapping clusters within the word distance', () => {
    const text = 'alpha one beta gap beta two alpha';
    const found = findNearbyMatches(text, 'alpha beta', options);

    expect(found.map(({ start, end }) => text.slice(start, end))).toEqual([
      'alpha one beta',
      'beta two alpha',
    ]);
    expect(found[0]!.runs.map(({ start, end }) => text.slice(start, end))).toEqual([
      'alpha',
      'beta',
    ]);
    expect(findNearbyMatches(text, 'alpha beta', { ...options, nearbyWords: 1 })).toEqual([]);
  });

  it('honors case and diacritics and rejects fewer than two effective query words', () => {
    expect(findNearbyMatches('Alpha café', 'alpha cafe', options)).toHaveLength(1);
    expect(findNearbyMatches('Alpha café', 'alpha cafe', { ...options, matchCase: true })).toEqual(
      [],
    );
    expect(
      findNearbyMatches('Alpha café', 'alpha cafe', { ...options, matchDiacritics: true }),
    ).toEqual([]);
    expect(() => findNearbyMatches('alpha', 'alpha ALPHA', options)).toThrow();
  });

  it('bounds result collection', () => {
    const text = 'alpha beta '.repeat(100);
    expect(findNearbyMatches(text, 'alpha beta', options, undefined, 10)).toHaveLength(10);
  });
});
