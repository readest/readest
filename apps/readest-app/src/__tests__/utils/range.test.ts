import { describe, it, expect } from 'vitest';
import { isRangeLike } from '@/utils/range';

describe('isRangeLike', () => {
  it('accepts a real Range', () => {
    expect(isRangeLike(document.createRange())).toBe(true);
  });

  it('accepts a cross-realm Range (range-like object that is NOT instanceof the top Range)', () => {
    // Simulates an iframe-realm Range: has Range methods but is not an instance
    // of this realm's Range constructor (the exact failure resolveCFI hits).
    const crossRealmRange = {
      startContainer: document.body,
      startOffset: 0,
      endContainer: document.body,
      endOffset: 0,
      cloneRange() {
        return this;
      },
      toString() {
        return 'word';
      },
    };
    expect(crossRealmRange instanceof Range).toBe(false);
    expect(isRangeLike(crossRealmRange)).toBe(true);
  });

  it('rejects a Node (no cloneRange)', () => {
    expect(isRangeLike(document.body)).toBe(false);
    expect(isRangeLike(document.createTextNode('x'))).toBe(false);
  });

  it('rejects null / undefined / primitives', () => {
    expect(isRangeLike(null)).toBe(false);
    expect(isRangeLike(undefined)).toBe(false);
    expect(isRangeLike('range')).toBe(false);
    expect(isRangeLike(42)).toBe(false);
  });
});
