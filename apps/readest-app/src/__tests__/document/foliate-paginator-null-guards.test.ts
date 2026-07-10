import { describe, expect, it, vi } from 'vitest';

import { getDirection } from 'foliate-js/paginator.js';

// A view's iframe document is blank/detached while a section loads or the view
// is torn down: body is null, and getComputedStyle(null) throws
// "parameter 1 is not of type 'Element'" (READEST-2X).
describe('getDirection null-document guard (READEST-2X)', () => {
  it('falls back to horizontal-ltr instead of calling getComputedStyle(null)', () => {
    const getComputedStyle = vi.fn((el: Element | null) => {
      if (!el) {
        throw new TypeError(
          "Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.",
        );
      }
      return { writingMode: 'horizontal-tb', direction: 'ltr' } as CSSStyleDeclaration;
    });
    const doc = {
      defaultView: { getComputedStyle },
      body: null,
      documentElement: { dir: '' },
    } as unknown as Document;

    expect(() => getDirection(doc)).not.toThrow();
    expect(getDirection(doc)).toEqual({ vertical: false, rtl: false });
    expect(getComputedStyle).not.toHaveBeenCalled();
  });

  it('still reads the writing mode from a present body', () => {
    const getComputedStyle = vi.fn(() => ({ writingMode: 'vertical-rl', direction: 'ltr' }));
    const doc = {
      defaultView: { getComputedStyle },
      body: { dir: '', querySelector: () => null },
      documentElement: { dir: '' },
    } as unknown as Document;

    expect(getDirection(doc)).toEqual({ vertical: true, rtl: true });
  });
});
