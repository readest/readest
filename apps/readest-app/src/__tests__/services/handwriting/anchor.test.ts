import { describe, expect, it } from 'vitest';

import {
  classifyShape,
  densify,
  effectiveShape,
  interiorSamples,
  columnBox,
  columnLines,
  fitFromBox,
  fitToBox,
  fromAnchorBox,
  fromFlow,
  fromSpan,
  toAnchorBox,
  toFlow,
  toSpan,
} from '@/services/handwriting/anchor';
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

describe('columnBox', () => {
  const line = (left: number, top: number, width: number) => ({ left, top, width, height: 20 });

  it('bounds the lines of a range in one column', () => {
    expect(columnBox([line(100, 500, 300), line(40, 524, 200)])).toEqual({
      left: 40,
      top: 500,
      width: 360,
      height: 44,
    });
  });

  it('stops at a column break so a range wrapping onto the next page cannot stretch the ink', () => {
    // The last line of one page, then the first line of the next column.
    expect(columnBox([line(100, 700, 300), line(640, 40, 200)])).toEqual(line(100, 700, 300));
  });

  it('ignores empty rects', () => {
    expect(columnBox([{ left: 0, top: 0, width: 0, height: 0 }, line(10, 10, 5)])).toEqual(
      line(10, 10, 5),
    );
    expect(columnBox([])).toBeNull();
  });
});

const line = (left: number, top: number, width: number, height = 20) => ({
  left,
  top,
  width,
  height,
});

describe('columnLines', () => {
  it('merges the fragments of one line', () => {
    // Two text nodes (a word in italics) on one line, then the next line.
    expect(columnLines([line(100, 500, 80), line(180, 502, 60), line(40, 524, 90)])).toEqual([
      { left: 100, top: 500, width: 140, height: 22 },
      line(40, 524, 90),
    ]);
  });
});

describe('classifyShape', () => {
  it('treats a flat stroke over text as a flow mark', () => {
    expect(classifyShape({ left: 0, top: 0, width: 120, height: 6 }, 20, true)).toBe('flow');
  });
  it('treats a round stroke over text as a box', () => {
    expect(classifyShape({ left: 0, top: 0, width: 80, height: 40 }, 20, true)).toBe('box');
  });
  it('treats a tall thin stroke beside text as a span', () => {
    expect(classifyShape({ left: 0, top: 0, width: 10, height: 90 }, 20, false)).toBe('span');
  });
  it('leaves margin writing rigid', () => {
    expect(classifyShape({ left: 0, top: 0, width: 50, height: 30 }, 20, false)).toBeUndefined();
  });
});

describe('flow marks', () => {
  const underline: [number, number][] = [
    [100, 524],
    [300, 524],
  ];

  it('round-trips on unchanged lines', () => {
    const lines = [line(100, 500, 200)];
    expect(fromFlow(toFlow(underline, lines), lines)).toEqual([underline]);
  });

  it('follows the words onto two lines when they re-wrap, one piece per line', () => {
    const stored = toFlow(densify(underline, 10), [line(100, 500, 200)]);
    // A larger font: the same words now fill the end of one line and the
    // start of the next.
    const wrapped = [line(250, 500, 150, 30), line(40, 536, 150, 30)];
    const [first, second] = fromFlow(stored, wrapped);
    // The first piece runs to the end of its line, the second from the start
    // of the next, both at the same offset under their text.
    expect(first![0]).toEqual([250, 536]);
    expect(first![first!.length - 1]![0]).toBeCloseTo(400);
    expect(second![0]![0]).toBeCloseTo(40);
    expect(second![second!.length - 1]).toEqual([190, 572]);
  });
});

describe('span marks', () => {
  it('stays beside the text edge and stretches with the lines', () => {
    const bar: [number, number][] = [
      [80, 500],
      [80, 600],
    ];
    const stored = toSpan(bar, line(100, 500, 300, 100), 20, 'spanL');
    // Larger line height: the same lines now run 500..650, text starts at 120.
    expect(fromSpan(stored, line(120, 500, 300, 150), 30, 'spanL')).toEqual([
      [90, 500],
      [90, 650],
    ]);
  });
});

describe('effectiveShape', () => {
  it('uses the shape a stroke was pinned with', () => {
    expect(effectiveShape('flow', true)).toBe('flow');
  });
  it('reads an unshaped stroke bound to a word range as a box fit', () => {
    // Ink pinned before shapes were stored was fitted to multi-word ranges.
    expect(effectiveShape(undefined, false)).toBe('box');
  });
  it('keeps an unshaped stroke bound to one character rigid', () => {
    expect(effectiveShape(undefined, true)).toBeUndefined();
  });
});

describe('interiorSamples', () => {
  it('samples the area a circle encloses, not its surroundings', () => {
    const circle: [number, number][] = Array.from({ length: 33 }, (_, i) => {
      const a = (i / 32) * Math.PI * 2;
      return [100 + 50 * Math.cos(a), 100 + 20 * Math.sin(a)];
    });
    const samples = interiorSamples(circle);
    expect(samples.length).toBeGreaterThan(5);
    for (const [x, y] of samples) {
      expect(((x - 100) / 50) ** 2 + ((y - 100) / 20) ** 2).toBeLessThan(1);
    }
  });

  it('has nothing inside a straight line', () => {
    expect(
      interiorSamples([
        [0, 0],
        [100, 0],
      ]),
    ).toEqual([]);
  });
});

describe('densify', () => {
  it('adds points along long segments so a mark can follow its text', () => {
    const dense = densify(
      [
        [0, 0],
        [100, 0],
      ],
      10,
    );
    expect(dense).toHaveLength(11);
    expect(dense[5]).toEqual([50, 0]);
  });

  it('keeps pressure, interpolated', () => {
    expect(
      densify(
        [
          [0, 0, 0.2],
          [20, 0, 0.6],
        ],
        10,
      )[1],
    ).toEqual([10, 0, 0.4]);
  });
});
