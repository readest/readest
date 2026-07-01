import { describe, expect, it } from 'vitest';

import { computePaginatedScroll } from 'foliate-js/fixed-layout.js';

describe('fixed-layout paginated page-turn scroll reset', () => {
  it('resets the vertical scroll to the top of the page on a page turn (#4683)', () => {
    // A tall fit-width page leaves the host scrolled to the bottom; turning to
    // the next page must start at the top, not inherit the previous offset.
    expect(
      computePaginatedScroll({
        elementWidth: 800,
        containerWidth: 800,
        scrollTop: 1200,
        pageTurn: true,
      }),
    ).toEqual({ scrollLeft: 0, scrollTop: 0 });
  });

  it('preserves the vertical scroll on a non-navigation re-render (resize/zoom/theme)', () => {
    expect(
      computePaginatedScroll({
        elementWidth: 800,
        containerWidth: 800,
        scrollTop: 1200,
        pageTurn: false,
      }),
    ).toEqual({ scrollLeft: 0, scrollTop: 1200 });
  });

  it('re-centers horizontally when the page is wider than the viewport', () => {
    expect(
      computePaginatedScroll({
        elementWidth: 1200,
        containerWidth: 800,
        scrollTop: 0,
        pageTurn: true,
      }),
    ).toEqual({ scrollLeft: 200, scrollTop: 0 });
  });
});
