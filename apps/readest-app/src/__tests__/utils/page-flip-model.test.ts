import { describe, expect, it } from 'vitest';
import {
  FLIP_FRAME_SIZE,
  FLIP_MIN_PRESSED_EDGE_X,
  FLIP_POINTS,
  PageFlipModel,
} from '@/utils/pageFlipModel';

const tick = 1 / 120;
const out = new Float32Array(FLIP_FRAME_SIZE);

/** Projected x of every profile point. */
const xs = (model: PageFlipModel, backward: boolean) => {
  model.frame(out, backward);
  return Array.from({ length: FLIP_POINTS }, (_, i) => out[i * 4]!);
};
const maxJump = (a: number[], b: number[]) => Math.max(...a.map((x, i) => Math.abs(x - b[i]!)));

describe('PageFlipModel', () => {
  it('rests flat on its own side of the spine', () => {
    const model = new PageFlipModel();
    expect(model.frame(out, false)).toBe(true);
    xs(model, false).forEach((x, i) => expect(x).toBeCloseTo(i / 64, 4));
    // Mirrored, the previous page waits off the page.
    expect(model.frame(out, true)).toBe(false);
  });

  it('leaves the page well before a tapped turn lands', () => {
    const model = new PageFlipModel();
    model.release(true, 0);
    let frames = 0;
    let leftAt = -1;
    while (model.advance(tick)) {
      frames++;
      if (leftAt < 0 && !model.frame(out, false)) leftAt = frames;
      expect(frames).toBeLessThan(600);
    }
    expect(leftAt).toBeGreaterThan(0);
    // The rest lands over the spine, off the page: the controller stops there.
    expect(leftAt).toBeLessThan(frames * 0.8);
    expect(model.frame(out, false)).toBe(false);
  });

  it('shows a backward sheet from the first move of its drag', () => {
    const model = new PageFlipModel();
    model.beginDrag(1, 0.5, 0);
    expect(model.frame(out, true)).toBe(false);
    model.moveDrag(FLIP_MIN_PRESSED_EDGE_X - (1 + FLIP_MIN_PRESSED_EDGE_X) * 0.05, 0.5, 0.016);
    expect(model.frame(out, true)).toBe(true);
  });

  it('lands a backward turn flat over the page', () => {
    const model = new PageFlipModel();
    model.release(true, 0);
    let frames = 0;
    while (model.advance(tick)) expect(++frames).toBeLessThan(600);
    xs(model, true).forEach((x, i) => expect(x).toBeCloseTo(i / 64, 2));
  });

  it('unwinds a drag cancelled past the fold without a jump', () => {
    for (const backward of [false, true]) {
      const model = new PageFlipModel();
      const edge = FLIP_MIN_PRESSED_EDGE_X;
      const start = backward ? 1 : 0.9;
      model.beginDrag(start, 0.5, 0);
      model.moveDrag(backward ? edge - (1 + edge) * 0.4 : start - 0.95, 0.5, 0.2);
      let previous = xs(model, backward);
      model.release(false, 0.2);
      let frames = 0;
      let largest = 0;
      while (model.advance(tick)) {
        const next = xs(model, backward);
        largest = Math.max(largest, maxJump(previous, next));
        previous = next;
        expect(++frames).toBeLessThan(600);
      }
      expect(largest, `backward=${backward}`).toBeLessThan(0.12);
      // Cancelled, the sheet rests flat on its own side again.
      xs(model, false).forEach((x, i) => expect(x).toBeCloseTo(i / 64, 3));
    }
  });
});
