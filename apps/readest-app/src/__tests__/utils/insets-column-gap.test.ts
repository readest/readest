import { describe, expect, it } from 'vitest';
import { getMarginalInlinePadding, getSpreadColumnGap } from '@/utils/insets';

describe('getMarginalInlinePadding', () => {
  it('keeps the derived padding without a column gap', () => {
    expect(getMarginalInlinePadding(5, 32)).toBe('calc(2.5% + 16px)');
    expect(getMarginalInlinePadding(5, 32, 0)).toBe('calc(2.5% + 16px)');
  });

  it("floors the padding at half the column gap, the text's outer edge", () => {
    expect(getMarginalInlinePadding(5, 32, 200)).toBe('max(calc(2.5% + 16px), 100px)');
  });

  it('offsets the floor by the host offset (the Duo inset)', () => {
    expect(getMarginalInlinePadding(5, 32, 200, 40)).toBe('max(calc(2.5% + 16px), 140px)');
  });
});

describe('getSpreadColumnGap', () => {
  const settings = { columnGapPx: 120, scrolled: false, vertical: false };

  it('applies the gap to a paginated horizontal spread', () => {
    expect(getSpreadColumnGap(settings, 2)).toBe(120);
  });

  it('is 0 wherever the paginator ignores the gap', () => {
    expect(getSpreadColumnGap(settings, 1)).toBe(0);
    expect(getSpreadColumnGap({ ...settings, scrolled: true }, 2)).toBe(0);
    expect(getSpreadColumnGap({ ...settings, vertical: true }, 2)).toBe(0);
  });
});
