import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useHoverIntent } from '@/hooks/useHoverIntent';

// The footer-bar hover strip used to summon the nav bar on raw mouseenter, so
// the bar popped up while the mouse merely traveled across the strip toward
// the footer info text. The hook requires the pointer to dwell before firing
// and cancels the pending trigger when the pointer leaves.
describe('useHoverIntent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires the callback only after the dwell delay', () => {
    const onHover = vi.fn();
    const { result } = renderHook(() => useHoverIntent(onHover, 300));

    result.current.start();
    vi.advanceTimersByTime(299);
    expect(onHover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onHover).toHaveBeenCalledTimes(1);
  });

  it('does not fire when cancelled before the delay (mouse passed through)', () => {
    const onHover = vi.fn();
    const { result } = renderHook(() => useHoverIntent(onHover, 300));

    result.current.start();
    vi.advanceTimersByTime(150);
    result.current.cancel();
    vi.advanceTimersByTime(1000);
    expect(onHover).not.toHaveBeenCalled();
  });

  it('restarting resets the dwell timer', () => {
    const onHover = vi.fn();
    const { result } = renderHook(() => useHoverIntent(onHover, 300));

    result.current.start();
    vi.advanceTimersByTime(200);
    result.current.start();
    vi.advanceTimersByTime(200);
    expect(onHover).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onHover).toHaveBeenCalledTimes(1);
  });

  it('clears the pending timer on unmount', () => {
    const onHover = vi.fn();
    const { result, unmount } = renderHook(() => useHoverIntent(onHover, 300));

    result.current.start();
    unmount();
    vi.advanceTimersByTime(1000);
    expect(onHover).not.toHaveBeenCalled();
  });
});
