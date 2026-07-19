import { describe, it, expect } from 'vitest';
import {
  MAX_AUTO_SCROLL_SPEED,
  MIN_AUTO_SCROLL_SPEED,
  AUTO_SCROLL_SPEED_STEP,
} from '@/services/constants';
import {
  AUTO_SCROLL_GESTURE_ACTIVATION_PX,
  AUTO_SCROLL_GESTURE_EDGE_RATIO,
  isInRightEdge,
  shouldActivate,
  speedToPosition,
  computeSpeed,
} from '@/app/reader/utils/autoScrollSpeedGesture';

describe('autoScrollSpeedGesture pure helpers', () => {
  describe('isInRightEdge', () => {
    it('is true on and above the right 10% boundary, false below', () => {
      const w = 1000;
      const boundary = w * (1 - AUTO_SCROLL_GESTURE_EDGE_RATIO); // 900
      expect(isInRightEdge(w, w)).toBe(true);
      expect(isInRightEdge(boundary, w)).toBe(true); // exactly 900
      expect(isInRightEdge(boundary - 1, w)).toBe(false);
    });

    it('is false for a non-positive view width', () => {
      expect(isInRightEdge(0, 0)).toBe(false);
      expect(isInRightEdge(5, -10)).toBe(false);
    });
  });

  describe('shouldActivate', () => {
    it('activates only when vertical-dominant past the threshold', () => {
      const t = AUTO_SCROLL_GESTURE_ACTIVATION_PX;
      expect(shouldActivate(0, t)).toBe(true); // exactly at threshold, dominant
      expect(shouldActivate(0, t - 1)).toBe(false); // below threshold
      expect(shouldActivate(0, -t)).toBe(true); // upward, magnitude counts
      expect(shouldActivate(10, 20)).toBe(true); // vertical-dominant
    });

    it('does not activate on horizontal-dominant or tie moves', () => {
      expect(shouldActivate(30, 20)).toBe(false); // horizontal-dominant
      expect(shouldActivate(20, 20)).toBe(false); // tie is not "> "
    });
  });

  describe('speedToPosition', () => {
    it('maps the speed range linearly onto [0,1]', () => {
      expect(speedToPosition(MIN_AUTO_SCROLL_SPEED)).toBeCloseTo(0, 10);
      expect(speedToPosition(MAX_AUTO_SCROLL_SPEED)).toBeCloseTo(1, 10);
      const mid = MIN_AUTO_SCROLL_SPEED + (MAX_AUTO_SCROLL_SPEED - MIN_AUTO_SCROLL_SPEED) / 2;
      expect(speedToPosition(mid)).toBeCloseTo(0.5, 10);
    });

    it('clamps out-of-range speeds', () => {
      expect(speedToPosition(0)).toBe(0);
      expect(speedToPosition(MAX_AUTO_SCROLL_SPEED + 100)).toBe(1);
    });
  });

  describe('computeSpeed', () => {
    it('swiping up (negative deltaY) increases speed; down decreases', () => {
      const start = 100;
      expect(computeSpeed(start, -100, 1000)).toBeGreaterThan(start);
      expect(computeSpeed(start, 100, 1000)).toBeLessThan(start);
    });

    it('a full view-height upward drag from min reaches max', () => {
      expect(computeSpeed(MIN_AUTO_SCROLL_SPEED, -1000, 1000)).toBe(MAX_AUTO_SCROLL_SPEED);
    });

    it('a full view-height downward drag from max reaches min', () => {
      expect(computeSpeed(MAX_AUTO_SCROLL_SPEED, 1000, 1000)).toBe(MIN_AUTO_SCROLL_SPEED);
    });

    it('snaps the result to the speed step', () => {
      expect(computeSpeed(100, -13, 1000) % AUTO_SCROLL_SPEED_STEP).toBe(0);
      expect(computeSpeed(137, -47, 1000) % AUTO_SCROLL_SPEED_STEP).toBe(0);
    });

    it('clamps to [min,max]', () => {
      expect(computeSpeed(MAX_AUTO_SCROLL_SPEED, -500, 1000)).toBe(MAX_AUTO_SCROLL_SPEED);
      expect(computeSpeed(MIN_AUTO_SCROLL_SPEED, 500, 1000)).toBe(MIN_AUTO_SCROLL_SPEED);
    });

    it('returns the clamped start when viewHeight is non-positive', () => {
      expect(computeSpeed(150, -50, 0)).toBe(150);
      expect(computeSpeed(1000, -50, 0)).toBe(MAX_AUTO_SCROLL_SPEED);
      expect(computeSpeed(10, -50, 0)).toBe(MIN_AUTO_SCROLL_SPEED);
    });
  });
});
