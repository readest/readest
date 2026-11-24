// @vitest-environment happy-dom
/**
 * The desktop / tablet dictionary popup can be resized from a corner grip
 * (#7344) and moved by its title row (#7713). The box lasts for the lookup
 * only: the next lookup opens at the default responsive size again.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (value: number) => value,
}));
vi.mock('@/hooks/useKeyDownActions', () => ({
  useKeyDownActions: vi.fn(),
}));
vi.mock('@/app/reader/components/annotator/DictionaryResultsView', () => ({
  useDictionaryResults: () => ({}),
  lookupToPin: () => ({}),
  DictionaryResultsHeader: ({
    dragHandleProps,
  }: {
    dragHandleProps?: React.HTMLAttributes<HTMLDivElement>;
  }) => (
    <div data-testid='title-row' {...dragHandleProps}>
      <button type='button'>back</button>
      header
    </div>
  ),
  DictionaryResultsBody: () => <div>body</div>,
}));

import DictionaryPopup from '@/app/reader/components/annotator/DictionaryPopup';
import type { Position } from '@/utils/sel';

const PADDING = 10;
const CELL = { w: 1200, h: 800 };

// Opened above the word: the popup's bottom edge rests on the selection.
const renderPopup = () => {
  const position: Position = { point: { x: 300, y: 100 }, dir: 'up' };
  const trianglePosition: Position = { point: { x: 540, y: 460 }, dir: 'up' };
  const { container } = render(
    <DictionaryPopup
      word='word'
      position={position}
      trianglePosition={trianglePosition}
      popupWidth={480}
      popupHeight={360}
    />,
  );
  const popup = container.querySelector<HTMLElement>('.popup-container')!;
  // jsdom has no layout: report the box Popup placed, in its cell's coordinates.
  const cell = { clientWidth: CELL.w, clientHeight: CELL.h };
  Object.defineProperties(popup, {
    offsetParent: { get: () => cell },
    offsetLeft: { get: () => parseFloat(popup.style.left) },
    offsetTop: { get: () => parseFloat(popup.style.top) },
    offsetWidth: { get: () => parseFloat(popup.style.width) },
    offsetHeight: { get: () => parseFloat(popup.style.height) },
  });
  const grip = container.querySelector<HTMLElement>('[data-dictionary-popup-resize]');
  expect(grip, 'the popup has a resize grip').not.toBeNull();
  const titleRow = container.querySelector<HTMLElement>('[data-testid="title-row"]')!;
  return { container, popup, grip: grip!, titleRow };
};

const drag = (grip: HTMLElement, dx: number, dy: number) => {
  fireEvent.pointerDown(grip, { clientX: 500, clientY: 500, pointerId: 1, button: 0 });
  fireEvent.pointerMove(grip, { clientX: 500 + dx, clientY: 500 + dy, pointerId: 1 });
  fireEvent.pointerUp(grip, { clientX: 500 + dx, clientY: 500 + dy, pointerId: 1 });
};

const boxOf = (popup: HTMLElement) => ({
  x: parseFloat(popup.style.left),
  y: parseFloat(popup.style.top),
  w: parseFloat(popup.style.width),
  h: parseFloat(popup.style.height),
});

describe('DictionaryPopup resize grip', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(cleanup);
  afterAll(() => vi.unstubAllGlobals());

  it('grows from the top-start corner with the pointer and lets go of the word', () => {
    const { container, popup, grip } = renderPopup();
    expect(container.querySelector('.popup-triangle-inner')).toBeTruthy();

    drag(grip, 120, 200);
    expect(boxOf(popup)).toEqual({ x: 300, y: 100, w: 600, h: 560 });
    // The box now covers the word it pointed at, so the triangle goes.
    expect(container.querySelector('.popup-triangle-inner')).toBeNull();
    expect(container.querySelector('.popup-triangle-outer')).toBeNull();
  });

  it('stays inside the book cell and never shrinks below the size it opened at', () => {
    const { popup, grip } = renderPopup();

    drag(grip, 5000, 5000);
    // The whole cell less the popup padding; the opposite corner moved back in.
    expect(boxOf(popup)).toEqual({
      x: PADDING,
      y: PADDING,
      w: CELL.w - 2 * PADDING,
      h: CELL.h - 2 * PADDING,
    });

    drag(grip, -5000, -5000);
    expect(boxOf(popup)).toMatchObject({ w: 480, h: 360 });
  });

  it('grows toward the start side when the UI is right-to-left', () => {
    const { popup, grip } = renderPopup();
    popup.style.direction = 'rtl';

    // In RTL the grip sits in the bottom-left corner: dragging left widens.
    drag(grip, -100, 0);
    expect(boxOf(popup)).toMatchObject({ x: 200, w: 580 });
  });

  it('opens the next lookup at the default size, remembering nothing', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const first = renderPopup();
    drag(first.grip, 200, 200);
    expect(boxOf(first.popup).w).toBe(680);
    cleanup();

    const { popup } = renderPopup();
    expect(popup.style.width).toBe('480px');
    expect(popup.style.height).toBe('360px');
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe('DictionaryPopup title-row move', () => {
  beforeAll(() => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });
  afterEach(cleanup);
  afterAll(() => vi.unstubAllGlobals());

  it('moves with the pointer at its size and lets go of the word', () => {
    const { container, popup, titleRow } = renderPopup();

    drag(titleRow, -200, 150);
    expect(boxOf(popup)).toEqual({ x: 100, y: 250, w: 480, h: 360 });
    expect(container.querySelector('.popup-triangle-inner')).toBeNull();
    expect(container.querySelector('.popup-triangle-outer')).toBeNull();
  });

  it('stays inside the book cell', () => {
    const { popup, titleRow } = renderPopup();

    drag(titleRow, 5000, 5000);
    expect(boxOf(popup)).toEqual({
      x: CELL.w - PADDING - 480,
      y: CELL.h - PADDING - 360,
      w: 480,
      h: 360,
    });

    drag(titleRow, -5000, -5000);
    expect(boxOf(popup)).toEqual({ x: PADDING, y: PADDING, w: 480, h: 360 });
  });

  it('stays on the word after a press with no real travel, like a tap', () => {
    const { container, popup, titleRow } = renderPopup();

    drag(titleRow, 2, -2);
    expect(boxOf(popup)).toEqual({ x: 300, y: 100, w: 480, h: 360 });
    expect(container.querySelector('.popup-triangle-inner')).toBeTruthy();
  });

  it('leaves presses on the title row buttons to the buttons', () => {
    const { container, popup, titleRow } = renderPopup();

    drag(titleRow.querySelector('button')!, -200, 150);
    expect(boxOf(popup)).toEqual({ x: 300, y: 100, w: 480, h: 360 });
    expect(container.querySelector('.popup-triangle-inner')).toBeTruthy();
  });

  it('widens after moving away from the cell edge it opened against', () => {
    const { popup, grip, titleRow } = renderPopup();
    // A word near the end edge: the grip has no room left to drag outward.
    drag(titleRow, 5000, 0);
    expect(boxOf(popup)).toMatchObject({ x: CELL.w - PADDING - 480, w: 480 });

    drag(titleRow, -400, 0);
    drag(grip, 300, 0);
    expect(boxOf(popup)).toMatchObject({ x: CELL.w - PADDING - 880, w: 780 });
  });
});
