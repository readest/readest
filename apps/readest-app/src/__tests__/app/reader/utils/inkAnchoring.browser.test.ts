import { afterEach, describe, expect, it } from 'vitest';

import { createInkAnchoring } from '@/app/reader/utils/inkAnchoring';
import type { InkPoint } from '@/services/handwriting/model';
import type { FoliateView } from '@/types/view';

// readest/readest#8027: a paragraph whose text ends in a space
// (`…by her. </p>`). Chromium lays that space out 0 px wide. Ink just after
// the paragraph covers it, and fitting the stroke to its box divided by zero:
// the NaN points crashed the pen renderer.

let frame: HTMLIFrameElement | null = null;

afterEach(() => {
  frame?.remove();
  frame = null;
});

const PAGE = { left: 0, top: 0, width: 600, height: 400 };

const setup = async (body: string) => {
  frame = document.createElement('iframe');
  Object.assign(frame.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${PAGE.width}px`,
    height: `${PAGE.height}px`,
    border: '0',
  });
  frame.srcdoc = `<html><body style="margin:0;font:20px/30px sans-serif">${body}</body></html>`;
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
  return { view, text, anchoring: createInkAnchoring(view, 0, PAGE)! };
};

const PARAGRAPH = '<p>A White Rabbit ran close by her. </p>';

/** The trailing space, and the middle of the line just after the last word. */
const endOf = (text: Text) => {
  const space = text.ownerDocument.createRange();
  space.setStart(text, text.length - 1);
  space.setEnd(text, text.length);
  const word = text.ownerDocument.createRange();
  word.setStart(text, text.length - 2);
  word.setEnd(text, text.length - 1);
  const { right, top, height } = word.getBoundingClientRect();
  return { space, right, y: top + height / 2 };
};

const toPage = (points: [number, number][]): InkPoint[] =>
  points.map(([x, y]): InkPoint => [x / PAGE.width, y / PAGE.height, 0.5]);

/** A small zigzag just after the last word: pinned as a box. */
const squiggle = (right: number, y: number) =>
  toPage([0, 6, 12, 18, 24, 30].map((dx, i) => [right + 6 + dx, y + (i % 2 ? -8 : 8)]));

/** A flat line just after the last word: pinned as a flow mark. */
const underline = (right: number, y: number) =>
  toPage([0, 10, 20, 30, 40, 50, 60].map((dx) => [right + 6 + dx, y + 4]));

const finite = (points: InkPoint[]) =>
  points.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y));

describe('ink after a paragraph that ends in a space (#8027)', () => {
  it.each([
    ['a squiggle', squiggle],
    ['an underline', underline],
  ])('pins %s drawn just after it with finite points', async (_, draw) => {
    const { text, anchoring } = await setup(PARAGRAPH);
    const { space, right, y } = endOf(text);
    // The trigger: the space is laid out with no width.
    expect(space.getBoundingClientRect().width, 'the trailing space has no width').toBe(0);

    const pinned = anchoring.pin(draw(right, y));

    expect(pinned, 'the stroke is pinned').not.toBeNull();
    expect(finite(pinned!.points), 'pinned points are finite').toBe(true);
    const placed = anchoring.place(pinned!);
    expect(placed, 'the stroke is placed').not.toBeNull();
    expect(placed!.every(finite), 'placed points are finite').toBe(true);
  });

  // Margin ink beside such a paragraph has always been pinned to the space
  // as a note, which only needs the box's height. Notes saved like that must
  // keep showing.
  it('still places a note pinned to the trailing space', async () => {
    const { view, text, anchoring } = await setup(PARAGRAPH);
    const note = {
      anchor: view.getCFI(0, endOf(text).space),
      points: [[0.5, 0.1, 0.5] as InkPoint],
    };

    const placed = anchoring.place(note);

    expect(placed, 'the saved note is placed').not.toBeNull();
    expect(placed!.every(finite), 'placed points are finite').toBe(true);
  });
});
