import { describe, test, expect, vi } from 'vitest';
import {
  Autoscroller,
  AUTOSCROLL_DEAD_ZONE_PX,
  AUTOSCROLL_SPEED_PER_PX,
  AUTOSCROLL_MAX_VELOCITY,
} from '@/app/reader/utils/autoscroller';

// Middle-click autoscroll core (#4951). The controller is pure logic driven by
// an injected rAF/clock so the speed model and the press/release state machine
// can be tested deterministically.
const createHarness = () => {
  let frameCb: FrameRequestCallback | null = null;
  let time = 0;
  const deltas: number[] = [];
  const onStop = vi.fn();
  const scroller = new Autoscroller({
    scrollBy: (delta) => deltas.push(delta),
    onStop,
    raf: (cb) => {
      frameCb = cb;
      return 1;
    },
    caf: () => {
      frameCb = null;
    },
    now: () => time,
  });
  // Advance the clock and fire the pending animation frame (which re-arms itself).
  const step = (ms: number) => {
    time += ms;
    const cb = frameCb;
    frameCb = null;
    cb?.(time);
  };
  const scrolledTotal = () => deltas.reduce((a, b) => a + b, 0);
  const hasPendingFrame = () => frameCb !== null;
  return { scroller, deltas, onStop, step, scrolledTotal, hasPendingFrame };
};

describe('Autoscroller speed model', () => {
  test('is inactive until started', () => {
    const { scroller, hasPendingFrame } = createHarness();
    expect(scroller.active).toBe(false);
    expect(hasPendingFrame()).toBe(false);
    scroller.start(100, 100, 'y');
    expect(scroller.active).toBe(true);
    expect(hasPendingFrame()).toBe(true);
  });

  test('does not scroll while the pointer stays within the dead zone', () => {
    const { scroller, step, scrolledTotal } = createHarness();
    scroller.start(100, 100, 'y');
    scroller.move(100, 100 + AUTOSCROLL_DEAD_ZONE_PX - 2);
    step(100);
    step(100);
    expect(scrolledTotal()).toBe(0);
  });

  test('scrolls proportionally to the distance beyond the dead zone', () => {
    const { scroller, step, scrolledTotal } = createHarness();
    scroller.start(100, 100, 'y');
    // 50px beyond the dead zone -> 50 * SPEED px/s; 100ms -> a tenth of that.
    scroller.move(100, 100 + AUTOSCROLL_DEAD_ZONE_PX + 50);
    step(100);
    expect(scrolledTotal()).toBe((50 * AUTOSCROLL_SPEED_PER_PX) / 10);
  });

  test('scrolls backwards when the pointer is before the anchor', () => {
    const { scroller, step, scrolledTotal } = createHarness();
    scroller.start(100, 100, 'y');
    scroller.move(100, 100 - AUTOSCROLL_DEAD_ZONE_PX - 50);
    step(100);
    expect(scrolledTotal()).toBe(-(50 * AUTOSCROLL_SPEED_PER_PX) / 10);
  });

  test('uses the x displacement on the horizontal axis and ignores y', () => {
    const { scroller, step, scrolledTotal } = createHarness();
    scroller.start(100, 100, 'x');
    scroller.move(100 + AUTOSCROLL_DEAD_ZONE_PX + 50, 500);
    step(100);
    expect(scrolledTotal()).toBe((50 * AUTOSCROLL_SPEED_PER_PX) / 10);
  });

  test('caps the scroll velocity', () => {
    const { scroller, step, scrolledTotal } = createHarness();
    scroller.start(100, 100, 'y');
    scroller.move(100, 100 + AUTOSCROLL_DEAD_ZONE_PX + 100000);
    step(100);
    expect(scrolledTotal()).toBe(AUTOSCROLL_MAX_VELOCITY / 10);
  });

  test('emits whole pixels and carries the fractional remainder', () => {
    const { scroller, deltas, step, scrolledTotal } = createHarness();
    scroller.start(100, 100, 'y');
    // 2px beyond the dead zone -> 2 * SPEED px/s (20px/s by default): a 10ms
    // frame yields 0.2px, below one pixel, so nothing may be emitted per frame.
    scroller.move(100, 100 + AUTOSCROLL_DEAD_ZONE_PX + 2);
    for (let i = 0; i < 10; i++) step(10);
    expect(scrolledTotal()).toBe((2 * AUTOSCROLL_SPEED_PER_PX) / 10);
    expect(deltas.every((d) => Number.isInteger(d))).toBe(true);
  });
});

describe('Autoscroller press/release state machine', () => {
  test('release after dragging beyond the dead zone stops scrolling', () => {
    const { scroller, onStop, step, scrolledTotal } = createHarness();
    scroller.start(100, 100, 'y');
    scroller.move(100, 100 + AUTOSCROLL_DEAD_ZONE_PX + 50);
    step(100);
    const scrolledWhileHeld = scrolledTotal();
    expect(scrolledWhileHeld).toBeGreaterThan(0);
    scroller.release();
    expect(scroller.active).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
    step(100);
    expect(scrolledTotal()).toBe(scrolledWhileHeld);
  });

  test('a quick release near the anchor enters sticky mode', () => {
    const { scroller, onStop, step, scrolledTotal } = createHarness();
    scroller.start(100, 100, 'y');
    scroller.move(100, 105);
    scroller.release();
    expect(scroller.active).toBe(true);
    expect(onStop).not.toHaveBeenCalled();
    scroller.move(100, 100 + AUTOSCROLL_DEAD_ZONE_PX + 50);
    step(100);
    expect(scrolledTotal()).toBeGreaterThan(0);
    scroller.stop();
    expect(scroller.active).toBe(false);
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  test('stop is idempotent and cancels the frame loop', () => {
    const { scroller, onStop, hasPendingFrame } = createHarness();
    scroller.stop();
    expect(onStop).not.toHaveBeenCalled();
    scroller.start(100, 100, 'y');
    scroller.stop();
    scroller.stop();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(hasPendingFrame()).toBe(false);
  });
});
