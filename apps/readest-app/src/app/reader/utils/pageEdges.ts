import type { Renderer } from '@/types/view';

// How far (px) a fixed-layout page's top / bottom edge may sit from the
// viewport's before its header / footer is hidden (#6596).
const PAGE_EDGE_TOLERANCE = 20;

interface Span {
  start: number;
  end: number;
}

// Whether a page runs through the line `edge` by more than the tolerance on
// both sides, i.e. its own edge is nowhere near the viewport's. Spans are in
// order along the axis, so only the first one ending past the band can.
const crossesEdge = (count: number, spanAt: (i: number) => Span, edge: number) => {
  let lo = 0;
  let hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spanAt(mid).end > edge + PAGE_EDGE_TOLERANCE) hi = mid;
    else lo = mid + 1;
  }
  return lo < count && spanAt(lo).start < edge - PAGE_EDGE_TOLERANCE;
};

// Whether the page's top / bottom edge sits at the viewport's, so the header /
// footer lands on the page's own margin rather than over its content. In
// fit-page mode the page fits the viewport and both always show.
export const getPageEdges = (renderer: Renderer) => {
  const viewTop = renderer.getBoundingClientRect().top;
  const viewBottom = viewTop + renderer.clientHeight;
  let count = 1;
  let spanAt: (i: number) => Span;
  if (renderer.scrolled && renderer.getAttribute('scroll-direction') !== 'horizontal') {
    // Vertical scroll flow stacks the pages, each with its own edges.
    const pages = renderer.shadowRoot?.querySelectorAll('.scroll-page') ?? [];
    count = pages.length;
    spanAt = (i) => {
      const rect = pages[i]!.getBoundingClientRect();
      return { start: rect.top, end: rect.bottom };
    };
  } else {
    // A paginated spread, or the row of a horizontal scroll flow, is one
    // block that pans vertically within the host once zoomed past its height.
    const start = viewTop - renderer.scrollTop;
    spanAt = () => ({ start, end: start + renderer.scrollHeight });
  }
  return {
    top: !crossesEdge(count, spanAt, viewTop),
    bottom: !crossesEdge(count, spanAt, viewBottom),
  };
};
