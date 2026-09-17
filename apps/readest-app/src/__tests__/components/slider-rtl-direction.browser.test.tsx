/**
 * Direction regression test for the Slider component (#6157).
 *
 * In a right-to-left book the reader's footer bar renders `dir='rtl'`, and a
 * native `<input type='range'>` under it mirrors itself: ArrowLeft *raises* the
 * value. The slider draws its own fill and thumb over that input, so the two
 * have to agree on which edge is the start. They did not — the component
 * resolved the direction once on mount, before `viewSettings.rtl` was known —
 * and the thumb ran the opposite way from the drag.
 *
 * jsdom cannot catch this: it has no layout, so a mirrored box and an
 * unmirrored one look identical. These cases measure the rendered boxes in
 * real Chromium instead.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { userEvent } from 'vitest/browser';

import '@/styles/globals.css';

import Slider from '@/components/Slider';

afterEach(cleanup);

type Dir = 'ltr' | 'rtl';

const TRACK_WIDTH = 300;
const HEIGHT = 44;

const sliderIn = (dir: Dir, initialValue: number) => (
  <div dir={dir} style={{ width: `${TRACK_WIDTH}px` }}>
    <Slider label='Reading Progress' initialValue={initialValue} heightPx={HEIGHT} />
  </div>
);

/**
 * Distances are reported from whichever edge the layout treats as the start, so
 * a correctly mirrored slider yields the same numbers in both directions.
 */
const boxes = (container: HTMLElement, dir: Dir) => {
  const at = (selector: string) =>
    container.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
  const track = at('.slider');
  const thumb = at('.slider-thumb');
  const fill = at('.slider-fill');
  const fromStart = (box: DOMRect) =>
    dir === 'rtl' ? track.right - box.right : box.left - track.left;
  return { track, thumb, fill, thumbFromStart: fromStart(thumb), fillFromStart: fromStart(fill) };
};

describe('Slider direction', () => {
  it('places the fill and the thumb as exact mirrors of each other', () => {
    const ltr = boxes(render(sliderIn('ltr', 25)).container, 'ltr');
    cleanup();
    const rtl = boxes(render(sliderIn('rtl', 25)).container, 'rtl');

    expect(rtl.track.width).toBeCloseTo(ltr.track.width, 0);
    expect(rtl.thumbFromStart).toBeCloseTo(ltr.thumbFromStart, 0);
    expect(rtl.fillFromStart).toBeCloseTo(ltr.fillFromStart, 0);
    expect(rtl.fillFromStart).toBeCloseTo(0, 0);

    // ...and genuinely on the other side, not merely equal by accident.
    expect(ltr.thumb.left - ltr.track.left).toBeLessThan(ltr.track.width / 2);
    expect(rtl.thumb.left - rtl.track.left).toBeGreaterThan(rtl.track.width / 2);
  });

  it('mirrors when the surrounding direction turns right-to-left after mount', () => {
    // The footer bar starts `ltr` and switches once FoliateViewer derives
    // `viewSettings.rtl` from the first loaded document. The panels — and these
    // sliders — are mounted well before that.
    const { container, rerender } = render(sliderIn('ltr', 25));
    const before = boxes(container, 'ltr');
    expect(before.thumb.left - before.track.left).toBeLessThan(before.track.width / 2);

    rerender(sliderIn('rtl', 25));

    const after = boxes(container, 'rtl');
    expect(after.thumbFromStart).toBeCloseTo(before.thumbFromStart, 0);
    expect(after.fillFromStart).toBeCloseTo(0, 0);
    expect(after.thumb.left - after.track.left).toBeGreaterThan(after.track.width / 2);
  });

  it.each([
    ['ltr', 'lowers'],
    ['rtl', 'raises'],
  ] as const)('moves the thumb left on ArrowLeft in %s (the value %s)', async (dir, _verb) => {
    // The gesture invariant the bug broke: whichever way the value counts, the
    // thumb has to travel the way the user pushed it.
    // Mounted `ltr` and flipped, the way a right-to-left book actually reaches
    // these sliders — a slider that only reads the direction once is already
    // stale by the time the user touches it.
    const { container, rerender } = render(sliderIn('ltr', 50));
    rerender(sliderIn(dir, 50));
    const input = container.querySelector<HTMLInputElement>('.slider-input')!;
    const startValue = Number(input.value);
    const startLeft = boxes(container, dir).thumb.left;

    await userEvent.click(input);
    await userEvent.keyboard('{ArrowLeft}');

    // The native input counts up leftwards when it is mirrored, down otherwise.
    expect(Number(input.value)).toBe(dir === 'rtl' ? startValue + 1 : startValue - 1);
    // Either way the thumb follows the key.
    expect(boxes(container, dir).thumb.left).toBeLessThan(startLeft);
  });
});
