import { describe, expect, it } from 'vitest';

import { fitFromBox, fitToBox, fromAnchorBox, toAnchorBox } from '@/services/handwriting/anchor';
import type { InkPoint } from '@/services/handwriting/model';

describe('anchor box offsets', () => {
  const box = { left: 100, top: 200, width: 10, height: 20 };

  it('stores points relative to the anchor box, in units of its height', () => {
    expect(toAnchorBox([[110, 240, 0.5]], box)).toEqual([[0.5, 2, 0.5]]);
  });

  it('follows the anchor when its text moves and scales', () => {
    const stored = toAnchorBox(
      [
        [100, 230],
        [140, 230],
      ],
      box,
    );
    // The word reflowed to another line and the font grew 1.5x.
    const moved = { left: 300, top: 50, width: 15, height: 30 };
    expect(fromAnchorBox(stored, moved)).toEqual([
      [300, 95],
      [360, 95],
    ] satisfies InkPoint[]);
  });
});

describe('fitting ink to the content range it covers', () => {
  const words = { left: 100, top: 200, width: 80, height: 20 };

  it('stores points normalized to the range box', () => {
    expect(fitToBox([[140, 230, 0.4]], words)).toEqual([[0.5, 1.5, 0.4]]);
  });

  it('keeps the shape around the words when their box reshapes', () => {
    // A circle around a phrase: corners of its bounding square.
    const circle: InkPoint[] = [
      [90, 190],
      [190, 190],
      [190, 230],
      [90, 230],
    ];
    const stored = fitToBox(circle, words);
    // A different font family made the phrase wider and the text taller.
    const reshaped = { left: 50, top: 400, width: 160, height: 30 };
    expect(fitFromBox(stored, reshaped)).toEqual([
      [30, 385],
      [230, 385],
      [230, 445],
      [30, 445],
    ] satisfies InkPoint[]);
  });
});
