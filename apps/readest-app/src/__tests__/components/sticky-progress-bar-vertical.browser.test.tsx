/**
 * In vertical writing mode the footer column is `writing-vertical-rl`, where
 * Tailwind's logical `inset-x-*` / `inset-y-*` (inset-inline / inset-block)
 * swap axes. The vertical bar must still fill the column top to bottom.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import StickyProgressBar from '@/app/reader/components/StickyProgressBar';

await import('@/styles/globals.css');

afterEach(cleanup);

describe('StickyProgressBar vertical (#7763)', () => {
  it('fills a writing-vertical-rl footer column top to bottom', () => {
    // The vertical footer as ProgressBar lays it out: a 16px-wide column.
    const { container } = render(
      <div className='writing-vertical-rl' style={{ width: 16, height: 400 }}>
        <div className='progress-strip flex h-full items-center gap-3'>
          <StickyProgressBar
            className='w-3 flex-1'
            fraction={0.5}
            tickFractions={[0.25, 0.75]}
            vertical
          />
        </div>
      </div>,
    );
    const bar = container.querySelector('.sticky-progress-bar')!.getBoundingClientRect();
    const track = container.querySelector('.sticky-progress-track')!.getBoundingClientRect();
    const fill = container.querySelector('.sticky-progress-fill')!.getBoundingClientRect();
    const ticks = [...container.querySelectorAll('.sticky-progress-tick')].map((t) =>
      t.getBoundingClientRect(),
    );

    expect(bar.height).toBe(400);
    expect(track.height).toBe(400);
    expect(track.width).toBe(8);
    // 1px border on each side of the track's 398px content box.
    expect(fill.top).toBe(track.top + 1);
    expect(fill.height).toBe(199);
    expect(fill.width).toBe(6);
    expect(ticks.map((t) => t.top - track.top - 1)).toEqual([99.5, 298.5]);
    expect(ticks.every((t) => t.width === 6 && t.height === 1)).toBe(true);
  });
});
