/**
 * The dictionary popup's resize grip (#7344) in real layout. The resize reads
 * the popup's offset box and its cell, and the grip's hit area must stay off
 * the body's scroll area; jsdom can only fake either.
 *
 * Needs real layout and the real stylesheet, so it runs as a browser test.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { page } from 'vitest/browser';

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (value: number) => value,
}));
vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: vi.fn(),
}));
vi.mock('@/app/reader/components/annotator/DictionaryResultsView', () => ({
  useDictionaryResults: () => ({}),
  DictionaryResultsHeader: () => <div className='h-10'>header</div>,
  // The real body's shape: a column whose scroll area fills it.
  DictionaryResultsBody: () => (
    <div className='flex h-full flex-col'>
      <div data-dictionary-scroll className='flex-1 overflow-y-auto'>
        <div style={{ height: 2000 }} />
      </div>
    </div>
  ),
}));

const { default: DictionaryPopup } = await import(
  '@/app/reader/components/annotator/DictionaryPopup'
);
await import('@/styles/globals.css');

const PADDING = 10;
const CELL = { w: 1200, h: 800 };

const renderInCell = () => {
  render(
    <div data-cell style={{ position: 'relative', width: CELL.w, height: CELL.h }}>
      <DictionaryPopup
        word='word'
        position={{ point: { x: 300, y: 100 }, dir: 'up' }}
        trianglePosition={{ point: { x: 540, y: 460 }, dir: 'up' }}
        popupWidth={480}
        popupHeight={360}
      />
    </div>,
  );
  const grip = document.querySelector<HTMLElement>('[data-dictionary-popup-resize]');
  expect(grip, 'the popup has a resize grip').not.toBeNull();
  const get = (selector: string) => document.querySelector<HTMLElement>(selector)!;
  return {
    cell: get('[data-cell]'),
    popup: get('.popup-container'),
    scroll: get('[data-dictionary-scroll]'),
    grip: grip!,
  };
};

// The element's border box in its cell's coordinates.
const boxIn = (cell: HTMLElement, el: HTMLElement) => {
  const c = cell.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
};

// Presses where the browser's hit test finds the grip 6px outside the popup's
// corner, so the part of the hit area past the popup's edges must be reachable.
const drag = (grip: HTMLElement, dx: number, dy: number) => {
  const p = grip.closest('.popup-container')!.getBoundingClientRect();
  const x = p.right + 6;
  const y = p.bottom + 6;
  const hit = document.elementFromPoint(x, y);
  expect(hit && grip.contains(hit), 'the grip is hit outside the popup').toBe(true);
  fireEvent.pointerDown(hit!, { pointerId: 1, button: 0, buttons: 1, clientX: x, clientY: y });
  fireEvent.pointerMove(grip, { pointerId: 1, buttons: 1, clientX: x + dx, clientY: y + dy });
  fireEvent.pointerUp(grip, { pointerId: 1, clientX: x + dx, clientY: y + dy });
};

describe('DictionaryPopup resize grip in real layout', () => {
  // Room for the whole cell: a hit test finds nothing outside the viewport.
  beforeAll(async () => {
    await page.viewport(CELL.w + 100, CELL.h + 100);
  });
  afterEach(cleanup);

  it('has a hit area of at least 32px that stays clear of the scroll area', () => {
    const { popup, grip, scroll } = renderInCell();
    const g = grip.getBoundingClientRect();
    const s = scroll.getBoundingClientRect();
    // DESIGN.md's minimum hit target, for a finger on a tablet.
    expect(g.width).toBeGreaterThanOrEqual(32);
    expect(g.height).toBeGreaterThanOrEqual(32);
    // Below the scroll area, so it never covers the scrollbar's down arrow.
    expect(g.top).toBeGreaterThanOrEqual(s.bottom);
    // The icon itself stays 16px, 4px in from the inner corner (past a 1px border).
    const icon = grip.querySelector('svg')!.getBoundingClientRect();
    const p = popup.getBoundingClientRect();
    expect([icon.width, p.right - icon.right, p.bottom - icon.bottom]).toEqual([16, 5, 5]);
  });

  it('resizes inside its cell and back to no less than the size it opened at', () => {
    const { cell, popup, grip } = renderInCell();
    expect(boxIn(cell, popup)).toEqual({ x: 300, y: 100, w: 480, h: 360 });

    drag(grip, 5000, 5000);
    expect(boxIn(cell, popup)).toEqual({
      x: PADDING,
      y: PADDING,
      w: CELL.w - 2 * PADDING,
      h: CELL.h - 2 * PADDING,
    });

    drag(grip, -5000, -5000);
    expect(boxIn(cell, popup)).toMatchObject({ w: 480, h: 360 });
  });
});
