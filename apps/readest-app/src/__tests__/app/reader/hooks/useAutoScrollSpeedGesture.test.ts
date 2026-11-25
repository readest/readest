import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

import type { AutoScrollState } from '@/app/reader/hooks/useAutoScroll';

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: null, isIPhoneDuo: false }),
}));

import { useAutoScrollSpeedGesture } from '@/app/reader/hooks/useAutoScrollSpeedGesture';

// The layer a book's page wipe lays its copy of the page being read in, and
// the copy, where touches on the page land.
const createCopy = () => {
  const host = document.createElement('div');
  const copy = document.createElement('div');
  host.append(copy);
  document.body.append(host);
  return { host, copy };
};

const touch = (
  target: Element,
  type: string,
  x: number,
  y: number,
  screen: { x: number; y: number },
) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y, screenX: screen.x, screenY: screen.y };
  Object.assign(event, { touches: type === 'touchend' ? [] : [point] });
  target.dispatchEvent(event);
};

const session = (setSpeed: () => void, host: HTMLElement) =>
  ({
    active: true,
    speed: 100,
    setSpeed,
    wipeCopyRef: { current: host },
  }) as unknown as AutoScrollState;

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

// #7575: while an Auto Scroll page wipe's copy of the page being read is up,
// touches meant for the book land on that copy; the swipe listens there too.
describe('useAutoScrollSpeedGesture on a page wipe', () => {
  test('arms by the app viewport, not the screen', () => {
    const setSpeed = vi.fn();
    const { host, copy } = createCopy();
    renderHook(() => useAutoScrollSpeedGesture(session(setSpeed, host)));
    const x = window.innerWidth - 5;
    // A window placed right of the screen origin: screen x is past the edge
    // for every touch, so only the viewport point tells the edge apart.
    const offset = 300;

    touch(copy, 'touchstart', x, 300, { x: x + offset, y: 300 });
    touch(copy, 'touchmove', x, 380, { x: x + offset, y: 380 });
    expect(setSpeed).toHaveBeenCalled();
    touch(copy, 'touchend', x, 380, { x: x + offset, y: 380 });

    setSpeed.mockClear();
    touch(copy, 'touchstart', 300, 300, { x: 300 + offset * 3, y: 300 });
    touch(copy, 'touchmove', 300, 380, { x: 300 + offset * 3, y: 380 });
    expect(setSpeed).not.toHaveBeenCalled();
  });

  // Two books in Auto Scroll each listen on the app document; the touch
  // landed on one book's copy.
  test('changes the speed of the book whose copy was touched only', () => {
    const other = vi.fn();
    const owner = vi.fn();
    const { host } = createCopy();
    const { host: ownerHost, copy } = createCopy();
    renderHook(() => useAutoScrollSpeedGesture(session(other, host)));
    renderHook(() => useAutoScrollSpeedGesture(session(owner, ownerHost)));
    const x = window.innerWidth - 5;

    touch(copy, 'touchstart', x, 300, { x, y: 300 });
    touch(copy, 'touchmove', x, 380, { x, y: 380 });
    expect(owner).toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });
});
