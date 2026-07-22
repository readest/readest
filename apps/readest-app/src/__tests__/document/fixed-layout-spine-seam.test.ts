// Regression test for readest/readest issue #4857.
//
// In a fixed-layout (EPUB or PDF) two-page spread at a fractional device pixel
// ratio (Windows display scale 150% -> devicePixelRatio 1.5), a one-pixel white
// seam appeared down the middle of the spread at the spine.
//
// Root cause: the two page iframes are independent compositor layers, each
// scaled by a (usually non-integer) factor. At a fractional devicePixelRatio the
// spine between them lands on a fractional device pixel, so each layer's edge
// there is anti-aliased against transparency and the reader background bleeds
// through as a thin white seam. (Filling the page canvas to its box, #4587, does
// not help: the soft edge comes from scaling the layer, not from the content
// stopping short of its box.)
//
// The fix overlaps the (top-most) right page onto the left by exactly one device
// pixel, so each soft edge sits over the neighbour's opaque content instead of
// the background. The shift is visual-only (translateX), leaving the centred
// spread layout untouched. `computeSpreadSpineOverlap` returns that translateX
// (in CSS px) for the right page, or 0 for layouts with no touching spine.

import { describe, expect, it } from 'vitest';

import { computeSpreadSpineOverlap } from 'foliate-js/fixed-layout.js';

describe('computeSpreadSpineOverlap (#4857)', () => {
  it('overlaps the right page by exactly one device pixel on a real two-page spread', () => {
    // Windows 150% scale: one device pixel is 1 / 1.5 CSS px.
    expect(computeSpreadSpineOverlap({ devicePixelRatio: 1.5 })).toBeCloseTo(-1 / 1.5, 10);
    // Retina / mobile: one device pixel is 0.5 CSS px.
    expect(computeSpreadSpineOverlap({ devicePixelRatio: 2 })).toBeCloseTo(-0.5, 10);
    // No scaling: one device pixel is one CSS px.
    expect(computeSpreadSpineOverlap({ devicePixelRatio: 1 })).toBeCloseTo(-1, 10);
  });

  it('defaults a missing/zero devicePixelRatio to 1 device pixel', () => {
    expect(computeSpreadSpineOverlap({})).toBeCloseTo(-1, 10);
    expect(computeSpreadSpineOverlap({ devicePixelRatio: 0 })).toBeCloseTo(-1, 10);
  });

  it('does not overlap layouts that have no touching spine', () => {
    // A single centred page (cover / odd page).
    expect(computeSpreadSpineOverlap({ center: true, devicePixelRatio: 1.5 })).toBe(0);
    // Portrait device: only one page of the spread is shown.
    expect(computeSpreadSpineOverlap({ portrait: true, devicePixelRatio: 1.5 })).toBe(0);
    // A spread slot padded with a blank page shows a single real page.
    expect(computeSpreadSpineOverlap({ leftBlank: true, devicePixelRatio: 1.5 })).toBe(0);
    expect(computeSpreadSpineOverlap({ rightBlank: true, devicePixelRatio: 1.5 })).toBe(0);
  });

  it('still overlaps a two-page spread when zoomed below 100%', () => {
    // Zoom is intentionally not an input: the pages stay adjacent at every zoom,
    // so a sub-100% spread gets the same overlap as a 100% one.
    expect(computeSpreadSpineOverlap({ devicePixelRatio: 2 })).toBeCloseTo(-0.5, 10);
  });
});
