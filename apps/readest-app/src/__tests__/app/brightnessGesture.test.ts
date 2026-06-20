import { describe, it, expect } from 'vitest';
import {
  BRIGHTNESS_GESTURE_ACTIVATION_PX,
  BRIGHTNESS_GESTURE_EDGE_RATIO,
  isInLeftEdge,
  shouldActivate,
  valueToPosition,
  positionToValue,
  computeBrightness,
} from '@/app/reader/utils/brightnessGesture';

describe('brightnessGesture pure helpers', () => {
  describe('isInLeftEdge', () => {
    it('is true on and below the 10% boundary, false above', () => {
      const w = 1000;
      expect(isInLeftEdge(0, w)).toBe(true);
      expect(isInLeftEdge(w * BRIGHTNESS_GESTURE_EDGE_RATIO, w)).toBe(true); // exactly 100
      expect(isInLeftEdge(101, w)).toBe(false);
    });

    it('is false for a non-positive view width', () => {
      expect(isInLeftEdge(0, 0)).toBe(false);
      expect(isInLeftEdge(5, -10)).toBe(false);
    });
  });

  describe('shouldActivate', () => {
    it('activates only when vertical-dominant past the threshold', () => {
      const t = BRIGHTNESS_GESTURE_ACTIVATION_PX;
      expect(shouldActivate(0, t)).toBe(true); // exactly 18, dominant
      expect(shouldActivate(0, t - 1)).toBe(false); // below threshold
      expect(shouldActivate(0, -t)).toBe(true); // upward, magnitude counts
      expect(shouldActivate(10, 20)).toBe(true); // vertical-dominant
    });

    it('does not activate on horizontal-dominant or tie moves', () => {
      expect(shouldActivate(30, 20)).toBe(false); // horizontal-dominant
      expect(shouldActivate(20, 20)).toBe(false); // tie is not "> "
    });
  });

  describe('perceptual curve (matches the menu slider pow(0.5))', () => {
    it('round-trips position -> value -> position', () => {
      for (const p of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
        expect(positionToValue(valueToPosition(positionToValue(p)))).toBeCloseTo(
          positionToValue(p),
          10,
        );
      }
    });

    it('value 0.25 sits at position 0.5 (slider convention)', () => {
      expect(valueToPosition(0.25)).toBeCloseTo(0.5, 10);
      expect(positionToValue(0.5)).toBeCloseTo(0.25, 10);
    });

    it('clamps out-of-range inputs', () => {
      expect(valueToPosition(-1)).toBe(0);
      expect(valueToPosition(2)).toBe(1);
      expect(positionToValue(-1)).toBe(0);
      expect(positionToValue(2)).toBe(1);
    });
  });

  describe('computeBrightness', () => {
    it('swiping up (negative deltaY) increases brightness', () => {
      const start = 0.25;
      const up = computeBrightness(start, -100, 1000);
      const down = computeBrightness(start, 100, 1000);
      expect(up).toBeGreaterThan(start);
      expect(down).toBeLessThan(start);
    });

    it('a full view-height upward drag reaches max', () => {
      expect(computeBrightness(0, -1000, 1000)).toBeCloseTo(1, 10);
    });

    it('a full view-height downward drag reaches min', () => {
      expect(computeBrightness(1, 1000, 1000)).toBeCloseTo(0, 10);
    });

    it('clamps to [0,1] and tolerates an unseeded / -1 start', () => {
      expect(computeBrightness(-1, -10, 1000)).toBeGreaterThanOrEqual(0);
      expect(computeBrightness(2, -10, 1000)).toBeLessThanOrEqual(1);
    });

    it('returns the clamped start when viewHeight is non-positive', () => {
      expect(computeBrightness(0.4, -50, 0)).toBeCloseTo(0.4, 10);
      expect(computeBrightness(-1, -50, 0)).toBe(0);
    });
  });
});
