// Feature test for readest/readest issue #6239.
//
// The captured page curl turns a two-column spread as a single leaf hinged at
// the spine (#6106): with `renderer.columnCount >= 2` the shader opens only the
// outer column and reflects it about the cell's horizontal centre. Reflowable
// books report that through the paginator; fixed-layout books (PDF, CBZ/CBR,
// fixed-layout EPUB/MOBI) reported nothing, so every one of them would curl as
// a single sheet.
//
// A fixed-layout spread is the one shape whose spine really does sit at the
// cell's centre: `computeSpreadInlineMargins` pushes both pages together at the
// spine and centres the pair. That is the same condition
// `computeSpreadSpineOverlap` uses to decide a seam needs hiding, so the two
// helpers must agree about what counts as a spread.

import { describe, expect, it } from 'vitest';

import { computeSpreadColumnCount, computeSpreadSpineOverlap } from 'foliate-js/fixed-layout.js';

const spread = { leftBlank: false, rightBlank: false };

describe('computeSpreadColumnCount (#6239)', () => {
  it('reports two columns for a real two-page spread', () => {
    expect(computeSpreadColumnCount(spread)).toBe(2);
  });

  it('reports one column for a centred single page', () => {
    expect(computeSpreadColumnCount({ ...spread, center: true })).toBe(1);
  });

  it('reports one column in portrait, where only half the spread is shown', () => {
    expect(computeSpreadColumnCount({ ...spread, portrait: true })).toBe(1);
  });

  it('reports one column when either side of the spread is a blank pad', () => {
    expect(computeSpreadColumnCount({ ...spread, leftBlank: true })).toBe(1);
    expect(computeSpreadColumnCount({ ...spread, rightBlank: true })).toBe(1);
  });

  it('reports one column before a spread has been laid out', () => {
    expect(computeSpreadColumnCount()).toBe(1);
    expect(computeSpreadColumnCount({ leftBlank: false })).toBe(1);
    expect(computeSpreadColumnCount({ rightBlank: false })).toBe(1);
  });

  it('reports one column in scroll mode, which has no spread at all', () => {
    expect(computeSpreadColumnCount({ ...spread, scrolled: true })).toBe(1);
  });

  // The leaf hinges where the seam is. Any layout the seam helper treats as
  // spineless must not be curled as two columns, or the hinge would fall in the
  // middle of a single page.
  it('agrees with the spine-seam helper about which layouts have a spine', () => {
    const shapes = [
      { center: false, portrait: false, leftBlank: false, rightBlank: false },
      { center: true, portrait: false, leftBlank: false, rightBlank: false },
      { center: false, portrait: true, leftBlank: false, rightBlank: false },
      { center: false, portrait: false, leftBlank: true, rightBlank: false },
      { center: false, portrait: false, leftBlank: false, rightBlank: true },
    ];
    for (const shape of shapes) {
      const hasSpine = computeSpreadSpineOverlap({ ...shape, devicePixelRatio: 2 }) !== 0;
      expect(computeSpreadColumnCount(shape) === 2).toBe(hasSpine);
    }
  });
});
