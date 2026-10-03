import { describe, expect, it } from 'vitest';

import { getPageEdges } from '@/app/reader/utils/pageEdges';
import type { Renderer } from '@/types/view';

// A fixed-layout page (PDF, CBZ) fills the screen in fit-page mode, so its
// header and footer sit on the page's own margins. Zoomed in, or in scrolled
// mode, the viewport's top and bottom land in the middle of a page and the
// title / progress would cover its content (#6596). They show only while the
// page's own top / bottom edge is within 20px of the viewport's.
const rect = (top: number, bottom: number) => ({ top, bottom }) as DOMRect;

const paginated = ({
  scrollTop,
  scrollHeight,
  clientHeight = 800,
  horizontal = false,
}: {
  scrollTop: number;
  scrollHeight: number;
  clientHeight?: number;
  horizontal?: boolean;
}): Renderer =>
  ({
    scrolled: horizontal,
    scrollTop,
    scrollHeight,
    clientHeight,
    getAttribute: (name: string) =>
      name === 'scroll-direction' ? (horizontal ? 'horizontal' : 'vertical') : null,
    getBoundingClientRect: () => rect(100, 100 + clientHeight),
    shadowRoot: null,
  }) as unknown as Renderer;

// Vertical scroll flow: pages of `height` stacked with a 4px gap, scrolled by
// `scrollTop`, in a viewport whose top sits at y=100.
const scrolled = (scrollTop: number, height = 1200, count = 50): Renderer => {
  const pages = Array.from({ length: count }, (_, i) => {
    const top = 100 + 4 + i * (height + 4) - scrollTop;
    return { getBoundingClientRect: () => rect(top, top + height) };
  });
  return {
    scrolled: true,
    scrollTop,
    scrollHeight: count * (height + 4) + 4,
    clientHeight: 800,
    getAttribute: () => 'vertical',
    getBoundingClientRect: () => rect(100, 900),
    shadowRoot: { querySelectorAll: () => pages },
  } as unknown as Renderer;
};

describe('getPageEdges', () => {
  it('shows both in fit-page mode, where the page fits the viewport', () => {
    expect(getPageEdges(paginated({ scrollTop: 0, scrollHeight: 800 }))).toEqual({
      top: true,
      bottom: true,
    });
  });

  it('shows only the header at the top of a zoomed page', () => {
    expect(getPageEdges(paginated({ scrollTop: 0, scrollHeight: 2000 }))).toEqual({
      top: true,
      bottom: false,
    });
    expect(getPageEdges(paginated({ scrollTop: 20, scrollHeight: 2000 }))).toEqual({
      top: true,
      bottom: false,
    });
  });

  it('hides both in the middle of a zoomed page', () => {
    expect(getPageEdges(paginated({ scrollTop: 600, scrollHeight: 2000 }))).toEqual({
      top: false,
      bottom: false,
    });
  });

  it('shows only the footer at the bottom of a zoomed page', () => {
    expect(getPageEdges(paginated({ scrollTop: 1185, scrollHeight: 2000 }))).toEqual({
      top: false,
      bottom: true,
    });
  });

  it('reads the vertical pan of a horizontal scroll flow like a paginated page', () => {
    expect(
      getPageEdges(paginated({ scrollTop: 300, scrollHeight: 1600, horizontal: true })),
    ).toEqual({ top: false, bottom: false });
  });

  it('shows the header only where a page starts in vertical scroll flow', () => {
    // Page 0 starts 4px below the viewport top.
    expect(getPageEdges(scrolled(0))).toEqual({ top: true, bottom: false });
    expect(getPageEdges(scrolled(500))).toEqual({ top: false, bottom: false });
    // Page 3 starts 10px above the viewport top.
    expect(getPageEdges(scrolled(3 * 1204 + 14))).toEqual({ top: true, bottom: false });
    // Page 3 starts 10px below it, just past page 2's end.
    expect(getPageEdges(scrolled(3 * 1204 - 6))).toEqual({ top: true, bottom: false });
  });

  it('shows the footer only where a page ends in vertical scroll flow', () => {
    // Page 2 ends 10px above the viewport bottom.
    expect(getPageEdges(scrolled(3 * 1204 - 800 + 10))).toEqual({ top: false, bottom: true });
    // Page 2 ends 30px below it.
    expect(getPageEdges(scrolled(3 * 1204 - 800 - 30))).toEqual({
      top: false,
      bottom: false,
    });
  });
});
