// readest/readest#6578: an OCR text layer (scanned PDFs) puts every word in
// its own span with its own jittered box, so a highlight drew one box per
// word, with gaps between words and stepped tops and bottoms. Rects that sit
// on the same line should paint as one flat strip.
import { describe, expect, it } from 'vitest';

import { Overlayer } from 'foliate-js/overlayer.js';

type Rect = { left: number; top: number; width: number; height: number };

const toRects = (boxes: Rect[]) =>
  boxes.map((b) => ({ ...b, right: b.left + b.width, bottom: b.top + b.height }));

// Word boxes from a line of the sample in #6578 (pdftotext -bbox, page 30).
const OCR_LINE: Rect[] = [
  { left: 64.5, top: 67.3, width: 25.3, height: 6.6 }, // There
  { left: 95.6, top: 69.7, width: 17.7, height: 5.8 }, // was,
  { left: 118.7, top: 71.2, width: 50.0, height: 5.0 }, // particularly,
  { left: 175.0, top: 68.3, width: 4.0, height: 5.3 }, // a
  { left: 184.9, top: 66.9, width: 31.9, height: 7.0 }, // marked
];
const OCR_NEXT_LINE: Rect[] = [
  { left: 36.1, top: 79.1, width: 20.0, height: 6.5 },
  { left: 60.0, top: 80.2, width: 30.0, height: 5.6 },
];

const shapes = (g: SVGGElement) => Array.from(g.children);

describe('Overlayer.highlight merges rects on the same line (#6578)', () => {
  it('draws one strip for the words of an OCR line', () => {
    const g = Overlayer.highlight(toRects(OCR_LINE), { radiusPadding: 0, padding: 0 });
    expect(shapes(g)).toHaveLength(1);
  });

  it('draws one strip per line across a line break', () => {
    const g = Overlayer.highlight(toRects([...OCR_LINE, ...OCR_NEXT_LINE]), {
      radiusPadding: 0,
      padding: 0,
    });
    expect(shapes(g)).toHaveLength(2);
  });

  it('spans the union of the merged boxes', () => {
    const g = Overlayer.highlight(toRects(OCR_LINE), { radius: 0, radiusPadding: 0 });
    const [rect] = shapes(g);
    expect(Number(rect!.getAttribute('x'))).toBeCloseTo(64.5);
    expect(Number(rect!.getAttribute('y'))).toBeCloseTo(66.9);
    expect(Number(rect!.getAttribute('width'))).toBeCloseTo(216.8 - 64.5);
    expect(Number(rect!.getAttribute('height'))).toBeCloseTo(76.2 - 66.9);
  });

  it('keeps a comma or a note number inside the line strip', () => {
    // "of only 0.6%,26 Produc-" from page 34 of the sample in #6578.
    const g = Overlayer.highlight(
      toRects([
        { left: 555, top: 1195.0, width: 39, height: 16.4 }, // only
        { left: 607, top: 1190.1, width: 43, height: 17.9 }, // 0.6%
        { left: 653, top: 1196.9, width: 3, height: 5.8 }, // ,
        { left: 656, top: 1183.9, width: 14, height: 11.9 }, // 26
        { left: 684, top: 1188.5, width: 72, height: 17.1 }, // Produc-
      ]),
      { radiusPadding: 0 },
    );
    expect(shapes(g)).toHaveLength(1);
  });

  it('keeps boxes far apart on the same line separate', () => {
    // Two table cells in one row.
    const g = Overlayer.highlight(
      toRects([
        { left: 10, top: 10, width: 40, height: 10 },
        { left: 200, top: 10, width: 40, height: 10 },
      ]),
      { radiusPadding: 0 },
    );
    expect(shapes(g)).toHaveLength(2);
  });

  it('keeps a much taller inline box, like an image, separate', () => {
    const g = Overlayer.highlight(
      toRects([
        { left: 10, top: 80, width: 40, height: 20 },
        { left: 50, top: 0, width: 100, height: 100 },
      ]),
      { radiusPadding: 0 },
    );
    expect(shapes(g)).toHaveLength(2);
  });

  it('merges the boxes of a vertical column', () => {
    const g = Overlayer.highlight(
      toRects([
        { left: 100, top: 10, width: 20, height: 40 },
        { left: 101, top: 52, width: 18, height: 30 },
        { left: 70, top: 10, width: 20, height: 40 },
      ]),
      { vertical: true, radius: 0, radiusPadding: 0 },
    );
    expect(shapes(g)).toHaveLength(2);
    const column = shapes(g).find((shape) => Number(shape.getAttribute('x')) === 100);
    expect(Number(column?.getAttribute('height'))).toBeCloseTo(72);
  });
});
