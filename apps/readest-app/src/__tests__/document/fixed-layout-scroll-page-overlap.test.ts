import { describe, expect, it } from 'vitest';

import { computeScrollPageOverlap } from 'foliate-js/fixed-layout.js';

// readest#6484: in Webtoon Mode (zero gap) every scroll page is pulled onto the
// previous one by two device pixels so the anti-aliased page edges sit over the
// neighbour's opaque content instead of the scroll background.
describe('computeScrollPageOverlap (#6484)', () => {
  it('overlaps touching pages by two device pixels', () => {
    expect(computeScrollPageOverlap({ gap: 0, devicePixelRatio: 1 })).toBeCloseTo(2, 10);
    expect(computeScrollPageOverlap({ gap: 0, devicePixelRatio: 1.25 })).toBeCloseTo(1.6, 10);
    expect(computeScrollPageOverlap({ gap: 0, devicePixelRatio: 2 })).toBeCloseTo(1, 10);
  });

  it('defaults a missing/zero devicePixelRatio to 1', () => {
    expect(computeScrollPageOverlap({ gap: 0 })).toBeCloseTo(2, 10);
    expect(computeScrollPageOverlap({ gap: 0, devicePixelRatio: 0 })).toBeCloseTo(2, 10);
  });

  it('does not overlap pages that have a gap between them', () => {
    expect(computeScrollPageOverlap({ gap: 4, devicePixelRatio: 2 })).toBe(0);
    // No scroll-gap attribute: the CSS default gap applies.
    expect(computeScrollPageOverlap({ gap: NaN, devicePixelRatio: 2 })).toBe(0);
  });
});
