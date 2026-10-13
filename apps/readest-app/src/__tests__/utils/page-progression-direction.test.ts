import { describe, expect, it } from 'vitest';
import { getPageProgressionRTL } from '@/libs/document';

// The direction a book turns its pages has four sources, and #6197 showed they
// have to be consulted in this order — a spine that declared `ltr` was
// overriding the writing mode the reader had chosen in Settings.
describe('getPageProgressionRTL', () => {
  it('follows the spine over the direction of any single document', () => {
    // An LTR colophon in a Japanese book still pages right-to-left, and an
    // RTL-scripted quotation in a Latin book does not drag the book with it.
    expect(getPageProgressionRTL('auto', 'rtl', false)).toBe(true);
    expect(getPageProgressionRTL('auto', 'ltr', true)).toBe(false);
  });

  it('keeps one direction across the mixed sections of the same book', () => {
    const verticalRl = true;
    const horizontalLtr = false;

    expect([
      getPageProgressionRTL('auto', 'rtl', verticalRl),
      getPageProgressionRTL('auto', 'rtl', horizontalLtr),
    ]).toEqual([true, true]);
  });

  it('leaves the choice to the document when the spine does not bind', () => {
    // `default` and a missing attribute both mean "reading system decides".
    for (const bookDir of [undefined, 'default']) {
      expect(getPageProgressionRTL('auto', bookDir, true)).toBe(true);
      expect(getPageProgressionRTL('auto', bookDir, false)).toBe(false);
    }
  });

  it('puts the reader’s own writing mode above the book', () => {
    // Forcing Vertical (RL) on a book whose spine says `ltr` must still page
    // right-to-left: vertical-rl reads that way by definition.
    expect(getPageProgressionRTL('vertical-rl', 'ltr', false)).toBe(true);
    // The other modes carry no direction of their own, so the book keeps it.
    expect(getPageProgressionRTL('vertical-lr', undefined, false)).toBe(false);
    expect(getPageProgressionRTL('horizontal-tb', 'rtl', false)).toBe(true);
  });
});
