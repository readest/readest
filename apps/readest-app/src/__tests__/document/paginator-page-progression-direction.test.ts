import { describe, expect, it } from 'vitest';
import { getPageProgressionRTL } from 'foliate-js/paginator.js';

// The EPUB spine's explicit page-progression-direction applies to the whole
// publication, independently of each spine document's writing mode. Document
// direction remains the fallback for EPUBs and other formats without an
// explicit book-level direction.
describe('paginator page progression direction', () => {
  it.each([
    ['rtl', false, true],
    ['rtl', true, true],
    ['ltr', true, false],
    [undefined, true, true],
    [undefined, false, false],
  ] as const)('uses book direction %s before document rtl %s', (bookDir, documentRTL, expected) => {
    expect(getPageProgressionRTL(bookDir, documentRTL)).toBe(expected);
  });

  it('keeps progression rtl across mixed horizontal and vertical spine items', () => {
    const bookDir = 'rtl';
    const horizontalLtr = false;
    const verticalRl = true;

    expect([
      getPageProgressionRTL(bookDir, horizontalLtr),
      getPageProgressionRTL(bookDir, verticalRl),
    ]).toEqual([true, true]);
  });
});
