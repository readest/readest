import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

import type { AutoScrollState } from '@/app/reader/hooks/useAutoScroll';

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ safeAreaInsets: null, isIPhoneDuo: false }),
}));

import { useAutoScrollSpeedGesture } from '@/app/reader/hooks/useAutoScrollSpeedGesture';

const touch = (type: string, x: number, y: number, screen: { x: number; y: number }) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const point = { clientX: x, clientY: y, screenX: screen.x, screenY: screen.y };
  Object.assign(event, { touches: type === 'touchend' ? [] : [point] });
  document.documentElement.dispatchEvent(event);
};

const session = (setSpeed: () => void, covering: boolean) =>
  ({
    active: true,
    speed: 100,
    setSpeed,
    isWipeCovering: () => covering,
  }) as unknown as AutoScrollState;

afterEach(() => {
  cleanup();
});

// #7575: while an Auto Scroll page wipe's snapshot is up, touches meant for
// the book land on the app document's root, where the swipe also listens.
describe('useAutoScrollSpeedGesture on the app document', () => {
  test('arms by the app viewport, not the screen', () => {
    const setSpeed = vi.fn();
    renderHook(() => useAutoScrollSpeedGesture(session(setSpeed, true)));
    const x = window.innerWidth - 5;
    // A window placed right of the screen origin: screen x is past the edge
    // for every touch, so only the viewport point tells the edge apart.
    const offset = 300;

    touch('touchstart', x, 300, { x: x + offset, y: 300 });
    touch('touchmove', x, 380, { x: x + offset, y: 380 });
    expect(setSpeed).toHaveBeenCalled();
    touch('touchend', x, 380, { x: x + offset, y: 380 });

    setSpeed.mockClear();
    touch('touchstart', 300, 300, { x: 300 + offset * 3, y: 300 });
    touch('touchmove', 300, 380, { x: 300 + offset * 3, y: 380 });
    expect(setSpeed).not.toHaveBeenCalled();
  });

  // Two books in Auto Scroll each listen on the app document; only one holds
  // the snapshot the touch landed on.
  test('changes the speed of the book holding the snapshot only', () => {
    const other = vi.fn();
    const owner = vi.fn();
    renderHook(() => useAutoScrollSpeedGesture(session(other, false)));
    renderHook(() => useAutoScrollSpeedGesture(session(owner, true)));
    const x = window.innerWidth - 5;

    touch('touchstart', x, 300, { x, y: 300 });
    touch('touchmove', x, 380, { x, y: 380 });
    expect(owner).toHaveBeenCalled();
    expect(other).not.toHaveBeenCalled();
  });
});
