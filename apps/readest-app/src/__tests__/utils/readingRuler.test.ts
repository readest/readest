import { describe, expect, it } from 'vitest';
import {
  buildLineBoxes,
  buildReadingRulerColumns,
  calculateReadingRulerPadding,
  calculateReadingRulerSize,
  clampReadingRulerPosition,
  filterVisibleLineBoxes,
  getReadingRulerMoveDirection,
  isReadingRulerMoveKey,
  snapReadingRulerColumns,
  snapReadingRulerToLines,
  stepReadingRulerPosition,
} from '@/app/reader/utils/readingRuler';

describe('readingRuler utils', () => {
  it('calculates fixed-layout ruler size from the configured line count', () => {
    expect(
      calculateReadingRulerSize(
        3,
        {
          defaultFontSize: 16,
          lineHeight: 1.5,
        },
        'EPUB',
      ),
    ).toBe(3 * 16 * 1.5);
  });

  it('calculates reflowable ruler size from font size and line height', () => {
    expect(
      calculateReadingRulerSize(
        2,
        {
          defaultFontSize: 18,
          lineHeight: 1.4,
        },
        'EPUB',
      ),
    ).toBe(50);
  });

  it('clamps the ruler center so the full ruler stays inside the viewport', () => {
    expect(clampReadingRulerPosition(5, 1000, 200)).toBe(10);
    expect(clampReadingRulerPosition(95, 1000, 200)).toBe(90);
    expect(clampReadingRulerPosition(33, 1000, 200)).toBe(33);
  });

  it('centers the ruler when it is larger than the viewport', () => {
    expect(clampReadingRulerPosition(10, 100, 120)).toBe(50);
    expect(clampReadingRulerPosition(90, 100, 120)).toBe(50);
  });

  it('moves by exactly one ruler window per navigation step', () => {
    expect(stepReadingRulerPosition(33, 1000, 200, 'forward')).toBe(53);
    expect(stepReadingRulerPosition(33, 1000, 200, 'backward')).toBe(13);
  });

  it('clamps stepped movement at the edges', () => {
    expect(stepReadingRulerPosition(85, 1000, 200, 'forward')).toBe(90);
    expect(stepReadingRulerPosition(15, 1000, 200, 'backward')).toBe(10);
  });

  it('maps tap and key sides to logical ruler movement direction', () => {
    expect(getReadingRulerMoveDirection('right', 'ltr')).toBe('forward');
    expect(getReadingRulerMoveDirection('left', 'ltr')).toBe('backward');
    expect(getReadingRulerMoveDirection('right', 'rtl')).toBe('backward');
    expect(getReadingRulerMoveDirection('left', 'rtl')).toBe('forward');
    expect(getReadingRulerMoveDirection('down', 'rtl')).toBe('forward');
    expect(getReadingRulerMoveDirection('up', 'ltr')).toBe('backward');
  });

  it('restricts arrow-key ruler movement to up/down in vertical layout', () => {
    // Vertical: only up/down move the ruler; left/right turn pages.
    expect(isReadingRulerMoveKey('up', true)).toBe(true);
    expect(isReadingRulerMoveKey('down', true)).toBe(true);
    expect(isReadingRulerMoveKey('left', true)).toBe(false);
    expect(isReadingRulerMoveKey('right', true)).toBe(false);
    // Horizontal: every arrow moves the ruler.
    expect(isReadingRulerMoveKey('up', false)).toBe(true);
    expect(isReadingRulerMoveKey('left', false)).toBe(true);
    expect(isReadingRulerMoveKey('right', false)).toBe(true);
  });

  it('pads each side by 0.3 of a line height', () => {
    // round(16 * 1.5 * 0.3) = 7
    expect(calculateReadingRulerPadding({ defaultFontSize: 16, lineHeight: 1.5 }, 'EPUB')).toBe(7);
    expect(calculateReadingRulerPadding({ defaultFontSize: 18, lineHeight: 1.5 }, 'EPUB')).toBe(8);
  });
});

type RectLike = {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
};

const rect = (top: number, left: number, height: number, width: number): RectLike => ({
  top,
  left,
  bottom: top + height,
  right: left + width,
  height,
  width,
});

const container = { top: 0, left: 0, right: 300, bottom: 400 };

describe('buildLineBoxes', () => {
  it('clusters horizontal fragments into one box per visual line', () => {
    const rects = [
      rect(0, 10, 16, 50), // line 1, fragment A
      rect(0, 60, 16, 40), // line 1, fragment B (same vertical band)
      rect(20, 10, 16, 80), // line 2
    ];
    expect(buildLineBoxes(rects, false, false, container)).toEqual([
      { start: 0, end: 16 },
      { start: 20, end: 36 },
    ]);
  });

  it('ignores zero-size rects', () => {
    const rects = [rect(0, 10, 16, 50), rect(20, 0, 0, 0), rect(40, 10, 16, 50)];
    expect(buildLineBoxes(rects, false, false, container)).toEqual([
      { start: 0, end: 16 },
      { start: 40, end: 56 },
    ]);
  });

  it('returns sorted boxes even when rects are out of order', () => {
    const rects = [rect(40, 10, 16, 50), rect(0, 10, 16, 50), rect(20, 10, 16, 50)];
    expect(buildLineBoxes(rects, false, false, container).map((b) => b.start)).toEqual([0, 20, 40]);
  });

  it('maps vertical-rl columns as distance from the right edge', () => {
    // container.right = 300; a column at left=260,right=276 -> [300-276, 300-260] = [24, 40]
    const rects = [rect(0, 260, 200, 16)];
    expect(buildLineBoxes(rects, true, true, container)).toEqual([{ start: 24, end: 40 }]);
  });

  it('maps vertical-lr columns as distance from the left edge', () => {
    const rects = [rect(0, 24, 200, 16)];
    expect(buildLineBoxes(rects, true, false, container)).toEqual([{ start: 24, end: 40 }]);
  });

  it('drops multi-line block rects so paragraphs are not merged into one box', () => {
    // Range.getClientRects() includes the <p> border box (h=160) alongside its
    // 4 line boxes; the tall block rect must be discarded, not merged.
    const rects = [
      rect(0, 10, 16, 400),
      rect(20, 10, 16, 400),
      rect(40, 10, 16, 400),
      rect(60, 10, 16, 400),
      rect(0, 10, 160, 400), // the paragraph block box
    ];
    expect(buildLineBoxes(rects, false, false, container)).toEqual([
      { start: 0, end: 16 },
      { start: 20, end: 36 },
      { start: 40, end: 56 },
      { start: 60, end: 76 },
    ]);
  });
});

describe('snapReadingRulerToLines', () => {
  // 10 lines, each 16px tall, 20px apart, starting at 0.
  const evenBoxes = [0, 20, 40, 60, 80, 100, 120, 140, 160, 180].map((s) => ({
    start: s,
    end: s + 16,
  }));

  it('returns null when there are no line boxes', () => {
    expect(snapReadingRulerToLines(0, 36, 2, 'forward', [])).toBeNull();
  });

  it('returns the next block of N lines as { start, end }', () => {
    // current block covers lines[0..1] => [0,36]; next group is lines[2..3] => [40,76].
    expect(snapReadingRulerToLines(0, 36, 2, 'forward', evenBoxes)).toEqual({ start: 40, end: 76 });
  });

  it('returns the previous block of N lines when moving backward', () => {
    // current block covers lines[2..3] => [40,76]; previous group is lines[0..1] => [0,36].
    expect(snapReadingRulerToLines(40, 76, 2, 'backward', evenBoxes)).toEqual({
      start: 0,
      end: 36,
    });
  });

  it('returns the first group from the top with -Infinity', () => {
    expect(snapReadingRulerToLines(-Infinity, -Infinity, 2, 'forward', evenBoxes)).toEqual({
      start: 0,
      end: 36,
    });
  });

  it('returns the last group from the bottom with Infinity', () => {
    expect(snapReadingRulerToLines(Infinity, Infinity, 2, 'backward', evenBoxes)).toEqual({
      start: 160,
      end: 196,
    });
  });

  it('returns null at the bottom boundary so the page can flip', () => {
    const boxes = [
      { start: 0, end: 16 },
      { start: 20, end: 36 },
    ];
    expect(snapReadingRulerToLines(0, 36, 2, 'forward', boxes)).toBeNull();
  });

  it('returns null at the top boundary so the page can flip', () => {
    const boxes = [
      { start: 80, end: 96 },
      { start: 100, end: 116 },
    ];
    expect(snapReadingRulerToLines(80, 116, 2, 'backward', boxes)).toBeNull();
  });

  it('re-snapping forward from a block start stays on the same block (no skip)', () => {
    // Anchoring the re-snap at the band's leading edge must return the same block,
    // not advance one line. (Anchoring at the band CENTER, which sits inside a line,
    // would skip to the next line — the page-turn "first line skipped" bug.)
    const blockStart = 40; // lines[2..3] => [40,76]
    expect(snapReadingRulerToLines(blockStart, blockStart, 2, 'forward', evenBoxes)).toEqual({
      start: 40,
      end: 76,
    });
    // A center anchor (sitting inside lines[2]) advances to the next group — the bug.
    const center = 48; // inside lines[2] (40..56)
    expect(snapReadingRulerToLines(center, center, 2, 'forward', evenBoxes)).toEqual({
      start: 60,
      end: 96,
    });
  });
});

describe('filterVisibleLineBoxes', () => {
  it('keeps lines at least half visible within the viewport and drops the rest', () => {
    const boxes = [
      { start: 0, end: 16 }, // fully visible
      { start: 190, end: 206 }, // 10/16 visible at the bottom edge -> kept
      { start: 196, end: 212 }, // 4/16 visible -> dropped
      { start: -8, end: 8 }, // 8/16 visible at the top edge -> kept
      { start: -12, end: 4 }, // 4/16 visible -> dropped
    ];
    expect(filterVisibleLineBoxes(boxes, 200)).toEqual([
      { start: 0, end: 16 },
      { start: 190, end: 206 },
      { start: -8, end: 8 },
    ]);
  });

  it('returns all line boxes when the dimension is unknown', () => {
    const boxes = [{ start: 500, end: 516 }];
    expect(filterVisibleLineBoxes(boxes, 0)).toEqual(boxes);
  });
});

describe('buildReadingRulerColumns', () => {
  // Two columns in a 1000px-wide overlay: col0 centers < 500, col1 centers >= 500.
  const colRect = (top: number, left: number): RectLike => rect(top, left, 16, 420);

  it('splits rects into columns by x and lines by y', () => {
    const rects = [colRect(0, 40), colRect(20, 40), colRect(0, 540), colRect(20, 540)];
    const cols = buildReadingRulerColumns(rects, 2, 1000, false);
    expect(cols).toEqual([
      {
        left: 40,
        right: 460,
        lines: [
          { start: 0, end: 16 },
          { start: 20, end: 36 },
        ],
      },
      {
        left: 540,
        right: 960,
        lines: [
          { start: 0, end: 16 },
          { start: 20, end: 36 },
        ],
      },
    ]);
  });

  it('orders columns right-to-left when rtl', () => {
    const rects = [colRect(0, 40), colRect(0, 540)];
    const cols = buildReadingRulerColumns(rects, 2, 1000, true);
    expect(cols.map((c) => c.left)).toEqual([540, 40]);
  });

  it('returns a single full-width column when columnCount is 1', () => {
    const rects = [colRect(0, 40), colRect(0, 540)];
    const cols = buildReadingRulerColumns(rects, 1, 1000, false);
    expect(cols).toHaveLength(1);
    expect(cols[0]!.lines).toHaveLength(1); // both rects share top 0 -> one line
  });

  it('drops multi-line block rects inside a column', () => {
    const rects = [
      colRect(0, 40),
      colRect(20, 40),
      colRect(40, 40),
      colRect(60, 40),
      rect(0, 40, 160, 420), // paragraph block box in column 0
    ];
    const cols = buildReadingRulerColumns(rects, 2, 1000, false);
    expect(cols).toHaveLength(1);
    expect(cols[0]!.lines).toEqual([
      { start: 0, end: 16 },
      { start: 20, end: 36 },
      { start: 40, end: 56 },
      { start: 60, end: 76 },
    ]);
  });
});

describe('snapReadingRulerColumns', () => {
  // col0: 5 lines (0..80); col1: 3 lines (0..40); each 16px tall, 20px apart.
  const columns = [
    {
      left: 40,
      right: 460,
      lines: [0, 20, 40, 60, 80].map((s) => ({ start: s, end: s + 16 })),
    },
    {
      left: 540,
      right: 960,
      lines: [0, 20, 40].map((s) => ({ start: s, end: s + 16 })),
    },
  ];

  it('advances within the active column', () => {
    // col0, current block lines[0..1] => [0,36]; next block lines[2..3] => [40,76].
    expect(snapReadingRulerColumns(0, 0, 36, 2, 'forward', columns)).toEqual({
      columnIndex: 0,
      start: 40,
      end: 76,
    });
  });

  it('jumps to the next column at the bottom of the current one', () => {
    // col0 current block lines[3..4] => [60,96]; nothing below -> col1 first block [0,36].
    expect(snapReadingRulerColumns(0, 60, 96, 2, 'forward', columns)).toEqual({
      columnIndex: 1,
      start: 0,
      end: 36,
    });
  });

  it('returns null past the last line of the last column', () => {
    // col1 current block covers its last lines [20,56]; no next group anywhere.
    expect(snapReadingRulerColumns(1, 20, 56, 2, 'forward', columns)).toBeNull();
  });

  it('jumps to the previous column when moving backward off the top', () => {
    // col1 current block [0,36]; nothing above in col1 -> col0 last block [60,96].
    expect(snapReadingRulerColumns(1, 0, 36, 2, 'backward', columns)).toEqual({
      columnIndex: 0,
      start: 60,
      end: 96,
    });
  });

  it('returns null when there are no columns', () => {
    expect(snapReadingRulerColumns(0, 0, 36, 2, 'forward', [])).toBeNull();
  });
});
