import { describe, expect, it } from 'vitest';

import {
  captureScrollModeAnchor,
  findScrollPageRange,
  layoutScrollPages,
  restoreScrollModeAnchor,
} from 'foliate-js/fixed-layout.js';

// The helpers are 1-D interval math along the scroll axis: vertical mode feeds
// offsetTop/offsetHeight, horizontal mode (readest#4995) feeds
// offsetLeft/offsetWidth, so the fields are axis-neutral (start/size/scrollPos).
describe('fixed-layout scroll mode anchor preservation', () => {
  it('captures the current intra-page offset', () => {
    const anchor = captureScrollModeAnchor(
      [
        { index: 0, start: 0, size: 1000 },
        { index: 1, start: 1008, size: 1000 },
      ],
      1350,
      1,
    );

    expect(anchor).toEqual({
      index: 1,
      fraction: 0.342,
      scrollPos: 1350,
    });
  });

  it('restores the same intra-page position after page sizes change', () => {
    const anchor = captureScrollModeAnchor(
      [
        { index: 0, start: 0, size: 1000 },
        { index: 1, start: 1008, size: 1000 },
      ],
      1350,
      1,
    );

    const restored = restoreScrollModeAnchor(
      [
        { index: 0, start: 0, size: 900 },
        { index: 1, start: 908, size: 900 },
      ],
      anchor,
      5000,
    );

    expect(restored).toBeCloseTo(1215.8);
    expect(restored).not.toBe(908);
  });

  it('falls back to the previous scroll position when the anchor page disappears', () => {
    const restored = restoreScrollModeAnchor(
      [{ index: 0, start: 0, size: 900 }],
      { index: 1, fraction: 0.4, scrollPos: 1350 },
      1200,
    );

    expect(restored).toBe(1200);
  });

  it('anchors horizontal page metrics the same way (offsetLeft/offsetWidth)', () => {
    const anchor = captureScrollModeAnchor(
      [
        { index: 0, start: 0, size: 240 },
        { index: 1, start: 248, size: 480 },
      ],
      368,
      0,
    );

    expect(anchor).toEqual({ index: 1, fraction: 0.25, scrollPos: 368 });
  });
});

describe('fixed-layout scroll mode page layout', () => {
  it('lays pages out like a flex column with a gap around each page', () => {
    expect(layoutScrollPages({ sizes: [100, 200, 100], gap: 4, overlap: 0 })).toEqual({
      starts: [4, 112, 320],
      sizes: [100, 200, 100],
      total: 424,
    });
  });

  it('pulls each page after the first onto the previous one by the overlap', () => {
    const { starts, total } = layoutScrollPages({ sizes: [100, 100], gap: 0, overlap: 1 });
    expect(starts).toEqual([0, 99]);
    expect(total).toBe(199);
  });

  it('finds the pages overlapping a span of the strip', () => {
    const layout = layoutScrollPages({ sizes: [100, 100, 100, 100], gap: 4, overlap: 0 });
    // pages sit at [4,104) [112,212) [220,320) [328,428)
    expect(findScrollPageRange(layout, 150, 330)).toEqual([1, 4]);
    expect(findScrollPageRange(layout, 106, 110)).toEqual([1, 1]);
    expect(findScrollPageRange(layout, -500, 0)).toEqual([0, 0]);
    expect(findScrollPageRange(layout, 1000, 2000)).toEqual([4, 4]);
  });
});
