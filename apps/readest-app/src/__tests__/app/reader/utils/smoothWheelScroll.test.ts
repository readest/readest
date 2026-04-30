import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import {
  SmoothScroller,
  isLikelyMouseWheel,
  type SmoothScrollTarget,
} from '@/app/reader/utils/smoothWheelScroll';

describe('isLikelyMouseWheel', () => {
  test('treats line-mode wheel events as mouse wheel regardless of magnitude', () => {
    expect(isLikelyMouseWheel({ deltaMode: 1, deltaX: 0, deltaY: 1 })).toBe(true);
    expect(isLikelyMouseWheel({ deltaMode: 1, deltaX: 0, deltaY: 3 })).toBe(true);
  });

  test('returns false when there is no vertical motion', () => {
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 0 })).toBe(false);
  });

  test('treats two-axis pixel motion as trackpad', () => {
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 8, deltaY: 200 })).toBe(false);
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: -1, deltaY: 100 })).toBe(false);
  });

  test('treats small per-event pixel deltas as trackpad even on a single axis', () => {
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 4 })).toBe(false);
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 49 })).toBe(false);
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: -49 })).toBe(false);
  });

  test('treats large single-axis pixel deltas as mouse wheel', () => {
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 100 })).toBe(true);
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 120 })).toBe(true);
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: -100 })).toBe(true);
    expect(isLikelyMouseWheel({ deltaMode: 0, deltaX: 0, deltaY: 53 })).toBe(true);
  });
});

const flushFrames = async (frames: number, advanceMs = 16) => {
  for (let i = 0; i < frames; i++) {
    vi.advanceTimersByTime(advanceMs);
    await Promise.resolve();
  }
};

describe('SmoothScroller', () => {
  let target: SmoothScrollTarget;
  let now: number;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    let raf = 0;
    const handles = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', ((cb: FrameRequestCallback) => {
      raf += 1;
      handles.set(raf, cb);
      setTimeout(() => {
        const fn = handles.get(raf);
        if (fn) {
          handles.delete(raf);
          now += 16;
          fn(now);
        }
      }, 16);
      return raf;
    }) as typeof requestAnimationFrame);
    vi.stubGlobal('cancelAnimationFrame', ((id: number) => {
      handles.delete(id);
    }) as typeof cancelAnimationFrame);

    let position = 0;
    target = {
      get position() {
        return position;
      },
      set position(value: number) {
        position = value;
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  test('moves toward target without overshooting', async () => {
    const scroller = new SmoothScroller();
    scroller.scrollBy(target, 200);

    await flushFrames(60);

    expect(target.position).toBeCloseTo(200, 1);
  });

  test('accumulates new deltas while animating', async () => {
    const scroller = new SmoothScroller();
    scroller.scrollBy(target, 100);
    await flushFrames(2);
    scroller.scrollBy(target, 100);

    await flushFrames(120);

    expect(target.position).toBeCloseTo(200, 1);
  });

  test('zero delta is a no-op', () => {
    const scroller = new SmoothScroller();
    scroller.scrollBy(target, 0);
    expect(target.position).toBe(0);
  });

  test('cancel stops the animation', async () => {
    const scroller = new SmoothScroller();
    scroller.scrollBy(target, 500);
    await flushFrames(2);
    const mid = target.position;
    scroller.cancel();
    await flushFrames(20);
    expect(target.position).toBe(mid);
  });

  test('handles negative deltas symmetrically', async () => {
    const scroller = new SmoothScroller();
    target.position = 500;
    scroller.scrollBy(target, -300);
    await flushFrames(120);
    expect(target.position).toBeCloseTo(200, 1);
  });

  test('stops cleanly when target is past a clamping boundary', async () => {
    const max = 100;
    let position = 0;
    const clampingTarget: SmoothScrollTarget = {
      get position() {
        return position;
      },
      set position(value: number) {
        position = Math.max(0, Math.min(max, value));
      },
    };

    const scroller = new SmoothScroller();
    scroller.scrollBy(clampingTarget, 5000);

    await flushFrames(200);

    expect(position).toBe(max);
  });
});
