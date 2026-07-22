import { describe, expect, it } from 'vitest';

import { computeScrollPinchTransform } from 'foliate-js/fixed-layout.js';

describe('computeScrollPinchTransform', () => {
  it('scales by the pinch ratio anchored at the viewport centre in both axes', () => {
    // Anchoring the live preview at the viewport centre (in container
    // coordinates) matches the post-pinch re-render, which restores the same
    // centre point via the center anchor, so the zoom does not jump on release.
    expect(
      computeScrollPinchTransform({
        ratio: 1.5,
        scrollLeft: 0,
        scrollTop: 2000,
        viewportWidth: 360,
        viewportHeight: 640,
      }),
    ).toEqual({
      transform: 'scale(1.5)',
      transformOrigin: '180px 2320px',
    });
  });

  it('offsets the origin by the current scroll position', () => {
    expect(
      computeScrollPinchTransform({
        ratio: 0.8,
        scrollLeft: 90,
        scrollTop: 0,
        viewportWidth: 360,
        viewportHeight: 640,
      }),
    ).toEqual({
      transform: 'scale(0.8)',
      transformOrigin: '270px 320px',
    });
  });
});
