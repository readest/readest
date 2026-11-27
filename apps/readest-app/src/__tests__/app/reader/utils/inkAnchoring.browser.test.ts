import { afterEach, describe, expect, it } from 'vitest';

import { createInkAnchoring } from '@/app/reader/utils/inkAnchoring';
import type { InkPoint } from '@/services/handwriting/model';
import type { FoliateView } from '@/types/view';

// readest/readest#8027: a paragraph whose text ends in a space
// (`…by her. </p>`). Chromium lays that space out with no size along the
// line: 0 px wide in horizontal text, 0 px tall in vertical text. Ink just
// after the paragraph lands on it, and fitting the stroke to its box divided
// by zero: the NaN points crashed the pen renderer.

let frame: HTMLIFrameElement | null = null;

afterEach(() => {
  frame?.remove();
  frame = null;
});

const PAGE = { left: 0, top: 0, width: 600, height: 400 };

const setup = async ({ body, style }: { body: string; style: string }) => {
  frame = document.createElement('iframe');
  Object.assign(frame.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${PAGE.width}px`,
    height: `${PAGE.height}px`,
    border: '0',
  });
  frame.srcdoc = `<html><body style="margin:0;font:20px/30px sans-serif;${style}">${body}</body></html>`;
  const loaded = new Promise((resolve) => frame!.addEventListener('load', resolve, { once: true }));
  document.body.append(frame);
  await loaded;
  const doc = frame.contentDocument!;
  // A stand-in for the CFI round trip: the anchor names a range it keeps.
  const ranges: Range[] = [];
  const view = {
    renderer: { getContents: () => [{ index: 0, doc }] },
    getCFI: (_index: number, range: Range) => `range:${ranges.push(range.cloneRange()) - 1}`,
    resolveCFI: (cfi: string) => ({
      index: 0,
      anchor: () => ranges[Number(cfi.slice('range:'.length))]!,
    }),
  } as unknown as FoliateView;
  const text = doc.querySelector('p')!.firstChild as Text;
  return { doc, view, text, anchoring: createInkAnchoring(view, 0, PAGE)! };
};

const HORIZONTAL = { body: '<p>A White Rabbit ran close by her. </p>', style: '' };
const VERTICAL = {
  body: '<p>吾輩は猫である。名前はまだ無い。 </p><p>どこで生れたかとんと見当がつかぬ。 </p>',
  style: 'writing-mode:vertical-rl',
};

/** The trailing space, and the box of the character before it. */
const endOf = (text: Text) => {
  const space = text.ownerDocument.createRange();
  space.setStart(text, text.length - 1);
  space.setEnd(text, text.length);
  const last = text.ownerDocument.createRange();
  last.setStart(text, text.length - 2);
  last.setEnd(text, text.length - 1);
  return { space, last: last.getBoundingClientRect() };
};

const toPage = (points: [number, number][]): InkPoint[] =>
  points.map(([x, y]): InkPoint => [x / PAGE.width, y / PAGE.height, 0.5]);

const STEPS = [0, 6, 12, 18, 24, 30];

/** A small zigzag just after the paragraph's last character. */
const squiggleAfter = (last: DOMRect) => {
  const y = last.top + last.height / 2;
  return toPage(STEPS.map((d, i) => [last.right + 6 + d, y + (i % 2 ? -8 : 8)]));
};

/** A flat line just after the paragraph's last character. */
const lineAfter = (last: DOMRect) =>
  toPage(STEPS.map((d) => [last.right + 6 + 2 * d, last.top + last.height / 2 + 4]));

/** The same strokes below the last character of a vertical line. */
const squiggleBelow = (last: DOMRect) => {
  const x = last.left + last.width / 2;
  return toPage(STEPS.map((d, i) => [x + (i % 2 ? -8 : 8), last.bottom + 6 + d]));
};
const lineBelow = (last: DOMRect) =>
  toPage(STEPS.map((d) => [last.left + last.width / 2 + 4, last.bottom + 6 + 2 * d]));

const finite = (points: InkPoint[]) =>
  points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

/** Placed as one piece, each point within half a pixel of where it was drawn, moved by (dx, dy). */
const asDrawn = (placed: InkPoint[][], drawn: InkPoint[], dx = 0, dy = 0) =>
  placed.length === 1 &&
  placed[0]!.length === drawn.length &&
  placed[0]!.every(
    ([x, y], i) =>
      Math.abs((x - drawn[i]![0]) * PAGE.width - dx) < 0.5 &&
      Math.abs((y - drawn[i]![1]) * PAGE.height - dy) < 0.5,
  );

describe('ink after a paragraph that ends in a space (#8027)', () => {
  it.each([
    ['a squiggle just after it', HORIZONTAL, squiggleAfter, 'width'],
    ['an underline just after it', HORIZONTAL, lineAfter, 'width'],
    ['a squiggle below it in vertical text', VERTICAL, squiggleBelow, 'height'],
    ['a line below it in vertical text', VERTICAL, lineBelow, 'height'],
  ] as const)('keeps %s with the paragraph', async (_, page, draw, axis) => {
    const { doc, view, text, anchoring } = await setup(page);
    const { space, last } = endOf(text);
    // The trigger: the space has no size along the line.
    expect(space.getBoundingClientRect()[axis], `the trailing space has no ${axis}`).toBe(0);
    const drawn = draw(last);

    const pinned = anchoring.pin(drawn);

    expect(pinned, 'the stroke is pinned').not.toBeNull();
    expect(finite(pinned!.points), 'pinned points are finite').toBe(true);
    const placed = anchoring.place(pinned!);
    expect(placed, 'the stroke is placed').not.toBeNull();
    expect(asDrawn(placed!, drawn), 'the stroke is placed where it was drawn').toBe(true);

    // Lines spread apart: the ink moves with the end of its paragraph.
    doc.body.style.lineHeight = '50px';
    const moved = endOf(text).last;
    const relaid = createInkAnchoring(view, 0, PAGE)!.place(pinned!);
    const [dx, dy] = [moved.left - last.left, moved.top - last.top];
    expect(dx || dy, 'the paragraph moved').not.toBe(0);
    expect(asDrawn(relaid!, drawn, dx, dy), 'the stroke moved with the paragraph').toBe(true);
  });

  // Margin ink beside such a paragraph has always been pinned to the space
  // as a note, which only needs the box's height. Notes saved like that must
  // keep showing.
  it('still places a note pinned to the trailing space', async () => {
    const { view, text, anchoring } = await setup(HORIZONTAL);
    const note = {
      anchor: view.getCFI(0, endOf(text).space),
      points: [[0.5, 0.1, 0.5] as InkPoint],
    };

    const placed = anchoring.place(note);

    expect(placed, 'the saved note is placed').not.toBeNull();
    expect(placed!.every(finite), 'placed points are finite').toBe(true);
  });
});
