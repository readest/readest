import { describe, expect, it } from 'vitest';

import { getCornerClearance } from '@/app/reader/utils/footerBand';

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
