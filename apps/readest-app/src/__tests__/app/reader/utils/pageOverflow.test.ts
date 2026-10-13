import { describe, expect, it } from 'vitest';

import { isPageOverflowing } from '@/app/reader/utils/pageOverflow';
import type { Renderer } from '@/types/view';

// A fixed-layout page's (PDF, CBZ) header and footer overlay the page, so they
// would cover its content wherever the page does not fit the viewport (#6596).
// They hide by layout, never by scroll position: showing them at every page
// edge made them flash on and off while scrolling, and on iOS each flip ended
// momentum scrolling dead.
const renderer = ({
  scrolled = false,
  horizontal = false,
  scrollHeight = 800,
}: {
  scrolled?: boolean;
  horizontal?: boolean;
  scrollHeight?: number;
}): Renderer =>
  ({
    scrolled,
    scrollHeight,
    clientHeight: 800,
    getAttribute: (name: string) =>
      name === 'scroll-direction' ? (horizontal ? 'horizontal' : 'vertical') : null,
  }) as unknown as Renderer;

describe('isPageOverflowing', () => {
  it('is false for a page that fits the viewport', () => {
    expect(isPageOverflowing(renderer({}))).toBe(false);
  });

  it('is true for a zoomed page that pans vertically', () => {
    expect(isPageOverflowing(renderer({ scrollHeight: 2000 }))).toBe(true);
  });

  it('is always true in vertical scroll flow, where the pages run on under the chrome', () => {
    expect(isPageOverflowing(renderer({ scrolled: true, scrollHeight: 800 }))).toBe(true);
    expect(isPageOverflowing(renderer({ scrolled: true, scrollHeight: 90000 }))).toBe(true);
  });

  it('reads a horizontal scroll flow by its vertical overflow', () => {
    expect(isPageOverflowing(renderer({ scrolled: true, horizontal: true }))).toBe(false);
    expect(
      isPageOverflowing(renderer({ scrolled: true, horizontal: true, scrollHeight: 1600 })),
    ).toBe(true);
  });
});
