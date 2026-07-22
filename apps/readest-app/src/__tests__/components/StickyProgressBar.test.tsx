import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import StickyProgressBar from '@/app/reader/components/StickyProgressBar';

afterEach(cleanup);

describe('StickyProgressBar', () => {
  it('renders the fill width proportional to the reading fraction', () => {
    const { container } = render(<StickyProgressBar fraction={0.5} tickFractions={[]} />);
    const fill = container.querySelector('.sticky-progress-fill') as HTMLElement;
    expect(fill).not.toBeNull();
    expect(fill.style.width).toBe('50%');
  });

  it('clamps the fraction to the 0..1 range', () => {
    const over = render(<StickyProgressBar fraction={1.8} tickFractions={[]} />);
    expect((over.container.querySelector('.sticky-progress-fill') as HTMLElement).style.width).toBe(
      '100%',
    );
    cleanup();
    const under = render(<StickyProgressBar fraction={-0.3} tickFractions={[]} />);
    expect(
      (under.container.querySelector('.sticky-progress-fill') as HTMLElement).style.width,
    ).toBe('0%');
  });

  it('outlines the bar with a thin (1px) rounded border', () => {
    const { container } = render(<StickyProgressBar fraction={0.5} tickFractions={[]} />);
    const track = container.querySelector('.sticky-progress-track') as HTMLElement;
    expect(track).not.toBeNull();
    expect(track.classList.contains('border')).toBe(true);
    expect(track.classList.contains('rounded-full')).toBe(true);
  });

  it('renders the ticks inside the clipping track so the rounded border crops them', () => {
    const { container } = render(<StickyProgressBar fraction={0} tickFractions={[0.25, 0.75]} />);
    const track = container.querySelector('.sticky-progress-track') as HTMLElement;
    expect(track.classList.contains('overflow-hidden')).toBe(true);
    // Ticks must be descendants of the rounded, clipped track — not siblings —
    // so ticks near the rounded ends are cropped and never exceed the border.
    expect(track.querySelectorAll('.sticky-progress-tick').length).toBe(2);
  });

  it('renders one tick per chapter boundary at its start-edge position (LTR)', () => {
    const { container } = render(<StickyProgressBar fraction={0} tickFractions={[0.25, 0.75]} />);
    const ticks = container.querySelectorAll('.sticky-progress-tick');
    expect(ticks.length).toBe(2);
    expect((ticks[0] as HTMLElement).style.left).toBe('25%');
    expect((ticks[1] as HTMLElement).style.left).toBe('75%');
  });

  it('positions fill and ticks from the right edge in RTL', () => {
    const { container } = render(<StickyProgressBar fraction={0.5} tickFractions={[0.25]} rtl />);
    const fill = container.querySelector('.sticky-progress-fill') as HTMLElement;
    expect(fill.style.right).toBe('0px');
    expect(fill.style.left).toBe('');
    const tick = container.querySelector('.sticky-progress-tick') as HTMLElement;
    expect(tick.style.right).toBe('25%');
  });
});
