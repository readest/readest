import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import Slider from '@/components/Slider';

afterEach(cleanup);

/**
 * Geometry only. The slider places its fill and thumb with logical properties
 * so the browser mirrors them from the inherited direction, and jsdom has no
 * layout, so it cannot tell a left-to-right placement from a right-to-left one.
 * The direction behaviour is covered in `slider-rtl-direction.browser.test.tsx`,
 * which measures the rendered boxes in Chromium.
 */
describe('Slider', () => {
  it('fills the track and centers the thumb on its end at the maximum value', () => {
    const { container, getByRole } = render(
      <Slider label='Reading Progress' initialValue={100} heightPx={44} />,
    );
    getByRole('slider');
    const fill = container.querySelector<HTMLElement>('.slider-fill')!;
    const thumb = container.querySelector<HTMLElement>('.slider-thumb')!;

    expect(fill.style.width).toBe('100%');
    expect(thumb.style.insetInlineStart).toBe('calc(100% - 22px)');
    expect(thumb.style.marginInlineStart).toBe('-22px');
  });

  it('centers the thumb on the start without filling the track at the minimum value', () => {
    const { container, getByRole } = render(
      <Slider label='Reading Progress' initialValue={0} heightPx={44} />,
    );
    getByRole('slider');
    const fill = container.querySelector<HTMLElement>('.slider-fill')!;
    const thumb = container.querySelector<HTMLElement>('.slider-thumb')!;

    expect(fill.style.width).toBe('0px');
    expect(thumb.style.insetInlineStart).toBe('22px');
  });

  it('keeps the thumb inside the track at intermediate positions', () => {
    const { container, getByRole, rerender } = render(
      <Slider label='Reading Progress' initialValue={25} heightPx={44} />,
    );
    getByRole('slider');
    const thumb = container.querySelector<HTMLElement>('.slider-thumb')!;

    expect(thumb.style.insetInlineStart).toBe('calc(25% + 11px)');

    rerender(<Slider label='Reading Progress' initialValue={75} heightPx={44} />);
    expect(thumb.style.insetInlineStart).toBe('calc(75% - 11px)');
  });

  it('never pins itself to a physical side', () => {
    // #6157: the slider used to resolve the surrounding direction in JS and
    // write `left` or `right`. That value was read once on mount and went
    // stale, leaving the visuals unmirrored while the native range input
    // mirrored itself. Nothing here may name a side or set its own `dir`.
    const { container } = render(
      <div dir='rtl'>
        <Slider label='Reading Progress' initialValue={40} heightPx={44} />
      </div>,
    );
    const slider = container.querySelector<HTMLElement>('.slider')!;
    expect(slider.hasAttribute('dir')).toBe(false);

    for (const el of container.querySelectorAll<HTMLElement>('.slider *, .slider')) {
      const style = el.getAttribute('style') ?? '';
      expect(style).not.toMatch(/(^|[;\s])(left|right)\s*:/);
      expect(el.className).not.toMatch(/(^|\s)-?(left|right)-/);
    }
  });
});
