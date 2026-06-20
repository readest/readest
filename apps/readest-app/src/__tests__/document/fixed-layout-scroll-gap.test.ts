import { describe, expect, it } from 'vitest';

import { scrollGapToCss } from 'foliate-js/fixed-layout.js';

describe('scrollGapToCss', () => {
  it('maps a non-negative number string to a px length', () => {
    expect(scrollGapToCss('0')).toBe('0px');
    expect(scrollGapToCss('4')).toBe('4px');
    expect(scrollGapToCss('12')).toBe('12px');
  });

  it('returns null for empty / invalid / negative / null so the CSS fallback (4px) applies', () => {
    expect(scrollGapToCss('')).toBeNull();
    expect(scrollGapToCss('abc')).toBeNull();
    expect(scrollGapToCss('-2')).toBeNull();
    expect(scrollGapToCss(null)).toBeNull();
  });
});
