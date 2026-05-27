import { describe, expect, it } from 'vitest';

import { captureScrollModeAnchor, restoreScrollModeAnchor } from 'foliate-js/fixed-layout.js';

describe('fixed-layout scroll mode anchor preservation', () => {
  it('captures the current intra-page offset', () => {
    const anchor = captureScrollModeAnchor(
      [
        { index: 0, top: 0, height: 1000 },
        { index: 1, top: 1008, height: 1000 },
      ],
      1350,
      1,
    );

    expect(anchor).toEqual({
      index: 1,
      fraction: 0.342,
      scrollTop: 1350,
    });
  });

  it('restores the same intra-page position after page sizes change', () => {
    const anchor = captureScrollModeAnchor(
      [
        { index: 0, top: 0, height: 1000 },
        { index: 1, top: 1008, height: 1000 },
      ],
      1350,
      1,
    );

    const restored = restoreScrollModeAnchor(
      [
        { index: 0, top: 0, height: 900 },
        { index: 1, top: 908, height: 900 },
      ],
      anchor,
      5000,
    );

    expect(restored).toBeCloseTo(1215.8);
    expect(restored).not.toBe(908);
  });

  it('falls back to the previous scrollTop when the anchor page disappears', () => {
    const restored = restoreScrollModeAnchor(
      [{ index: 0, top: 0, height: 900 }],
      { index: 1, fraction: 0.4, scrollTop: 1350 },
      1200,
    );

    expect(restored).toBe(1200);
  });
});
