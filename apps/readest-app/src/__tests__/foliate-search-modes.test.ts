// Tests for the Calibre-parity search modes added in #4560:
//   - regex          : JS RegExp over the section's joined text
//   - nearby-words   : whole words occurring within N words of each other
//
// These exercise `search(strs, query, opts)` directly (the same unit seam the
// existing excerpt regression test uses), where `strs` is the per-text-node
// string array `textWalker` produces.
import { describe, expect, it } from 'vitest';

import { search } from 'foliate-js/search.js';

interface Excerpt {
  pre: string;
  match: string;
  post: string;
  segments?: { text: string; emphasized: boolean }[];
}
interface FlatRange {
  startIndex: number;
  startOffset: number;
  endIndex: number;
  endOffset: number;
}
interface Result {
  range: FlatRange;
  excerpt: Excerpt;
  subRanges?: FlatRange[];
}

const run = (strs: string[], query: string, opts: Record<string, unknown>): Result[] =>
  [...search(strs, query, opts)] as Result[];

describe('regex mode', () => {
  it('matches a pattern and reports the matched text', () => {
    const r = run(['the cat sat on the mat'], 'c.t', { mode: 'regex' });
    expect(r.map((x) => x.excerpt.match)).toEqual(['cat']);
  });

  it('is case-insensitive by default and case-sensitive with matchCase', () => {
    expect(run(['Cat cat'], 'cat', { mode: 'regex' }).length).toBe(2);
    const cased = run(['Cat cat'], 'cat', { mode: 'regex', matchCase: true });
    expect(cased.length).toBe(1);
    expect(cased[0]!.excerpt.match).toBe('cat');
  });

  it('maps a match spanning multiple text nodes back to a range', () => {
    const r = run(['the qu', 'ick fox'], 'qu.ck', { mode: 'regex' });
    expect(r.length).toBe(1);
    expect(r[0]!.excerpt.match).toBe('quick');
    expect(r[0]!.range.startIndex).toBe(0);
    expect(r[0]!.range.endIndex).toBe(1);
  });

  it('does not loop forever on a zero-width pattern', () => {
    expect(run(['abc'], 'x*', { mode: 'regex' })).toEqual([]);
  });

  it('throws a typed error on an invalid pattern', () => {
    expect(() => run(['abc'], '(', { mode: 'regex' })).toThrow(/regular expression/i);
    try {
      run(['abc'], '(', { mode: 'regex' });
    } catch (e) {
      expect((e as { code?: string }).code).toBe('INVALID_REGEX');
    }
  });
});

describe('nearby-words mode', () => {
  const opts = (nearbyWords: number) => ({ mode: 'nearby-words', nearbyWords });

  it('matches when all words fall within N words of each other', () => {
    const r = run(['alpha one two three beta end'], 'alpha beta', opts(10));
    expect(r.length).toBe(1);
    expect(r[0]!.excerpt.match).toContain('alpha');
    expect(r[0]!.excerpt.match).toContain('beta');
    expect(r[0]!.subRanges?.length).toBe(2);
  });

  it('rejects clusters whose word span exceeds N', () => {
    expect(run(['alpha one two three beta'], 'alpha beta', opts(2)).length).toBe(0);
  });

  it('is order independent', () => {
    const r = run(['beta x y alpha'], 'alpha beta', opts(10));
    expect(r.length).toBe(1);
  });

  it('emits one cluster per non-overlapping occurrence pair', () => {
    const r = run(['alpha beta gamma delta alpha beta'], 'alpha beta', opts(3));
    expect(r.length).toBe(2);
  });

  it('produces a segmented excerpt emphasizing only the matched words', () => {
    const r = run(['alpha one beta'], 'alpha beta', opts(10));
    const segments = r[0]!.excerpt.segments ?? [];
    const emphasized = segments.filter((s) => s.emphasized).map((s) => s.text);
    expect(emphasized).toEqual(['alpha', 'beta']);
    expect(segments.some((s) => !s.emphasized && s.text.includes('one'))).toBe(true);
  });

  it('throws when fewer than two distinct words are given', () => {
    expect(() => run(['alpha alpha'], 'alpha', opts(10))).toThrow();
    try {
      run(['alpha'], 'alpha', opts(10));
    } catch (e) {
      expect((e as { code?: string }).code).toBe('NEARBY_NEEDS_TWO_WORDS');
    }
  });
});
