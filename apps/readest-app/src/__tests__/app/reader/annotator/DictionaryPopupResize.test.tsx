/**
 * The desktop / tablet dictionary popup can be resized from a corner grip
 * (#7344). The size lasts for the lookup only: the next lookup opens at the
 * default responsive size again.
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
  DictionaryResultsHeader: () => <div>header</div>,
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
  return { container, popup, grip: grip! };
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
