import { describe, expect, it } from 'vitest';

import { compileSearchRegex, filterWholeWordMatches, findRegexMatches } from '@/utils/textSearch';

describe('findRegexMatches', () => {
  it('returns offsets for each match up to the limit', () => {
    const regex = compileSearchRegex('\\d+', false);
    expect(findRegexMatches('a1 b22 c333', regex)).toEqual([
      { start: 1, end: 2 },
      { start: 4, end: 6 },
      { start: 8, end: 11 },
    ]);
    expect(findRegexMatches('a1 b22 c333', regex, 2)).toHaveLength(2);
  });

  it('respects case sensitivity and skips empty matches', () => {
    expect(findRegexMatches('Ab ab', compileSearchRegex('ab', true))).toEqual([
      { start: 3, end: 5 },
    ]);
    expect(findRegexMatches('abc', compileSearchRegex('x*', false))).toEqual([]);
  });

  it('throws INVALID_REGEX for malformed patterns', () => {
    expect(() => compileSearchRegex('(', false)).toThrow(
      expect.objectContaining({ code: 'INVALID_REGEX' }),
    );
  });
});

describe('filterWholeWordMatches', () => {
  it('keeps only matches aligned to word boundaries', () => {
    const text = 'the cat scattered';
    const matches = [
      { start: 4, end: 7 }, // "cat" — whole word
      { start: 9, end: 12 }, // "cat" inside "scattered"
    ];
    expect(filterWholeWordMatches(text, matches, 'en')).toEqual([{ start: 4, end: 7 }]);
  });

  it('supports dictionary-segmented CJK words', () => {
    const text = '宝玉和黛玉说话';
    const index = text.indexOf('黛玉');
    const kept = filterWholeWordMatches(text, [{ start: index, end: index + 2 }], 'zh');
    expect(kept).toEqual([{ start: index, end: index + 2 }]);
  });
});
