import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import Slider from '@/components/Slider';

afterEach(cleanup);

describe('Slider', () => {
  it('fills the track and centers the thumb on its end at the maximum value', () => {
    const { container, getByRole } = render(
      <Slider label='Reading Progress' initialValue={100} heightPx={44} />,
    );
    getByRole('slider');
    const fill = container.querySelector<HTMLElement>('.slider-fill')!;
    const thumb = container.querySelector<HTMLElement>('.slider-thumb')!;

    expect(fill.style.width).toBe('100%');
    expect(thumb.style.left).toBe('calc(100% - 22px)');
  });

  it('centers the thumb on the start without filling the track at the minimum value', () => {
    const { container, getByRole } = render(
      <Slider label='Reading Progress' initialValue={0} heightPx={44} />,
    );
    getByRole('slider');
    const fill = container.querySelector<HTMLElement>('.slider-fill')!;
    const thumb = container.querySelector<HTMLElement>('.slider-thumb')!;

    expect(fill.style.width).toBe('0px');
    expect(thumb.style.left).toBe('22px');
  });

  it('keeps the thumb inside the track at intermediate positions', () => {
    const { container, getByRole, rerender } = render(
      <Slider label='Reading Progress' initialValue={25} heightPx={44} />,
    );
    getByRole('slider');
    const thumb = container.querySelector<HTMLElement>('.slider-thumb')!;

    expect(thumb.style.left).toBe('calc(25% + 11px)');

    rerender(<Slider label='Reading Progress' initialValue={75} heightPx={44} />);
    expect(thumb.style.left).toBe('calc(75% - 11px)');
  });

  it('uses the right edge as the endpoint in right-to-left layouts', async () => {
    const { container, getByRole } = render(
      <div dir='rtl'>
        <Slider label='Reading Progress' initialValue={100} heightPx={44} />
      </div>,
    );
    getByRole('slider');
    const fill = container.querySelector<HTMLElement>('.slider-fill')!;
    const thumb = container.querySelector<HTMLElement>('.slider-thumb')!;

    await waitFor(() => expect(thumb.style.right).toBe('calc(100% - 22px)'));
    expect(fill.style.right).toBe('0px');
    expect(fill.style.width).toBe('100%');
  });
});
