import { describe, test, expect } from 'vitest';
import { createWheelGestureDetector, WheelSample } from '@/app/reader/utils/wheelGesture';

const sample = (over: Partial<WheelSample> & Pick<WheelSample, 'timeStamp'>): WheelSample => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ...over,
});

describe('createWheelGestureDetector', () => {
  test('ignores a single tiny horizontal touch below the threshold', () => {
    const detector = createWheelGestureDetector({ threshold: 30 });
    expect(detector.feed(sample({ deltaX: 4, timeStamp: 0 }))).toBeNull();
  });

  test('ignores sporadic tiny touches spaced beyond the idle gap (Magic Mouse brush)', () => {
    // Each light brush emits a tiny delta; spaced apart they must never
    // accumulate into a page turn — this is the accidental-flip bug.
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    let t = 0;
    for (let i = 0; i < 20; i++) {
      t += 500; // > idle gap, so accumulators reset between touches
      expect(detector.feed(sample({ deltaX: 8, timeStamp: t }))).toBeNull();
    }
  });

  test('flips exactly once when a deliberate horizontal swipe crosses the threshold', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    expect(detector.feed(sample({ deltaX: 12, timeStamp: 0 }))).toBeNull();
    expect(detector.feed(sample({ deltaX: 12, timeStamp: 16 }))).toBeNull();
    const flip = detector.feed(sample({ deltaX: 12, timeStamp: 32 }));
    expect(flip).not.toBeNull();
    expect(flip!.deltaX).toBeGreaterThan(0);
    expect(flip!.deltaY).toBe(0);
  });

  test('swallows the inertial momentum tail after a flip', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    expect(detector.feed(sample({ deltaX: 40, timeStamp: 0 }))).not.toBeNull();
    // Momentum tail: continuous decaying events within the idle gap.
    let t = 0;
    for (let i = 0; i < 30; i++) {
      t += 16;
      expect(detector.feed(sample({ deltaX: 35, timeStamp: t }))).toBeNull();
    }
  });

  test('starts a new gesture after the wheel goes idle', () => {
    const detector = createWheelGestureDetector({ threshold: 30, idleResetMs: 200 });
    expect(detector.feed(sample({ deltaX: 40, timeStamp: 0 }))).not.toBeNull();
    // Idle gap elapses, then a fresh deliberate swipe.
    expect(detector.feed(sample({ deltaX: 40, timeStamp: 1000 }))).not.toBeNull();
  });

  test('resolves to the dominant axis, ignoring cross-axis noise', () => {
    const detector = createWheelGestureDetector({ threshold: 30 });
    // Large horizontal travel with small vertical jitter.
    detector.feed(sample({ deltaX: 20, deltaY: 3, timeStamp: 0 }));
    const flip = detector.feed(sample({ deltaX: 20, deltaY: -2, timeStamp: 16 }));
    expect(flip).not.toBeNull();
    expect(flip!.deltaY).toBe(0);
    expect(flip!.deltaX).toBeGreaterThan(0);
  });

  test('preserves direction sign for negative (left/up) swipes', () => {
    const detector = createWheelGestureDetector({ threshold: 30 });
    detector.feed(sample({ deltaY: -16, timeStamp: 0 }));
    const flip = detector.feed(sample({ deltaY: -16, timeStamp: 16 }));
    expect(flip).not.toBeNull();
    expect(flip!.deltaY).toBeLessThan(0);
    expect(flip!.deltaX).toBe(0);
  });

  test('normalizes line-mode deltas so one wheel notch flips a page', () => {
    const detector = createWheelGestureDetector({ threshold: 30, lineHeight: 40 });
    // A single line-mode notch (3 lines) normalizes to 120px > threshold.
    const flip = detector.feed(sample({ deltaY: 3, deltaMode: 1, timeStamp: 0 }));
    expect(flip).not.toBeNull();
    expect(flip!.deltaY).toBeGreaterThan(0);
  });

  test('reset() clears accumulated travel', () => {
    const detector = createWheelGestureDetector({ threshold: 30 });
    detector.feed(sample({ deltaX: 20, timeStamp: 0 }));
    detector.reset();
    // After reset the earlier 20px is forgotten, so 20px more is still short.
    expect(detector.feed(sample({ deltaX: 20, timeStamp: 16 }))).toBeNull();
  });
});
