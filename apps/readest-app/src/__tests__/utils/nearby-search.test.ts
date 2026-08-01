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

  it('falls back to substring occurrences for terms the segmenter splits', () => {
    const text =
      '只不过黄仁勋卖的不是铲子，而是售价3万美元、包含1000亿个晶体管的人工智能训练芯片。';
    const found = findNearbyMatches(text, '芯片 黄仁勋', {
      locale: 'zh',
      matchCase: false,
      matchDiacritics: false,
      nearbyWords: 40,
    });

    expect(found).toHaveLength(1);
    const runTexts = found[0]!.runs.map(({ start, end }) => text.slice(start, end)).sort();
    expect(runTexts).toEqual(['芯片', '黄仁勋']);
  });

  it('counts CJK distance in grapheme clusters, not segmenter tokens', () => {
    const text = '黄仁勋发布了新一代芯片。';
    const zhOptions = { locale: 'zh', matchCase: false, matchDiacritics: false };

    // Unit distance between the two terms is ~9 word-like characters.
    expect(findNearbyMatches(text, '芯片 黄仁勋', { ...zhOptions, nearbyWords: 12 })).toHaveLength(
      1,
    );
    expect(findNearbyMatches(text, '芯片 黄仁勋', { ...zhOptions, nearbyWords: 5 })).toHaveLength(
      0,
    );
  });

  it('measures CJK distance in characters rather than segmenter tokens', () => {
    // Multi-character tokens make token distance (11) and character distance
    // (20) diverge; the character semantics must win.
    const text = '芯片与人工智能高性能计算平台深度学习框架黄仁勋。';
    const zhOptions = { locale: 'zh', matchCase: false, matchDiacritics: false };

    expect(findNearbyMatches(text, '芯片 黄仁勋', { ...zhOptions, nearbyWords: 21 })).toHaveLength(
      1,
    );
    expect(findNearbyMatches(text, '芯片 黄仁勋', { ...zhOptions, nearbyWords: 15 })).toHaveLength(
      0,
    );
  });
});
