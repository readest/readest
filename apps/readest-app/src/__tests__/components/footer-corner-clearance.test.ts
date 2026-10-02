import { describe, expect, it } from 'vitest';

import { getCellCornerRadii, getCornerClearance } from '@/app/reader/utils/footerBand';

// Phones with rounded screen corners clip the ends of the footer when its text
// sits low enough to fall inside the corner arc. The clearance is how far the
// arc reaches inward at the text's lowest point, plus a small breathing gap.
describe('getCornerClearance', () => {
  it('is zero without a rounded corner', () => {
    expect(getCornerClearance(0, 2)).toBe(0);
  });

  it('is zero once the text sits above the corner arc', () => {
    expect(getCornerClearance(45, 45)).toBe(0);
    expect(getCornerClearance(45, 60)).toBe(0);
  });

  it('follows the arc when the text sits inside the corner', () => {
    // R - sqrt(R^2 - (R - h)^2) + 4 = 45 - sqrt(2025 - 1849) + 4
    expect(getCornerClearance(45, 2)).toBeCloseTo(35.73, 1);
    // A higher text line needs less inset.
    expect(getCornerClearance(45, 16)).toBeCloseTo(14.59, 1);
  });

  it('treats text touching the screen edge as needing the full radius', () => {
    expect(getCornerClearance(45, 0)).toBe(49);
    expect(getCornerClearance(45, -3)).toBe(49);
  });
});

// A book cell only meets the rounded corners its bottom edge actually shares
// with the screen: side by side, the inner edges sit mid-screen.
describe('getCellCornerRadii', () => {
  const landscape = 16 / 9;
  const portrait = 9 / 16;

  it('gives a single book both bottom corners', () => {
    expect(getCellCornerRadii(0, 1, portrait, 49)).toEqual({ left: 49, right: 49 });
  });

  it('gives side-by-side books only their outer corner', () => {
    expect(getCellCornerRadii(0, 2, landscape, 49)).toEqual({ left: 49, right: 0 });
    expect(getCellCornerRadii(1, 2, landscape, 49)).toEqual({ left: 0, right: 49 });
  });

  it('gives stacked books corners only on the bottom row', () => {
    expect(getCellCornerRadii(0, 2, portrait, 49)).toEqual({ left: 0, right: 0 });
    expect(getCellCornerRadii(1, 2, portrait, 49)).toEqual({ left: 49, right: 49 });
  });

  it('gives nothing when the screen reports no radius', () => {
    expect(getCellCornerRadii(0, 1, portrait, 0)).toEqual({ left: 0, right: 0 });
  });
});
