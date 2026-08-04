import { describe, expect, it } from 'vitest';

import { captureScrollModeAnchor, restoreScrollModeAnchor } from 'foliate-js/fixed-layout.js';

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
