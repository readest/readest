import { describe, expect, it } from 'vitest';
import {
  AUTO_SCROLL_GESTURE_EDGE_RATIO,
  isInRightEdge,
} from '@/app/reader/utils/autoScrollSpeedGesture';
import { BRIGHTNESS_GESTURE_EDGE_RATIO, isInLeftEdge } from '@/app/reader/utils/brightnessGesture';

// The Duo's status strip is a large left/right inset (#6307); the gesture
// zones start past it. Off the Duo the hooks pass no inset, i.e. 0.
describe('edge gesture zones with an edge inset', () => {
  it('left zone starts past the strip', () => {
    const w = 1000;
    expect(isInLeftEdge(290, w, BRIGHTNESS_GESTURE_EDGE_RATIO, 190)).toBe(true);
    expect(isInLeftEdge(291, w, BRIGHTNESS_GESTURE_EDGE_RATIO, 190)).toBe(false);
  });

  it('right zone ends before the strip', () => {
    const w = 1000;
    expect(isInRightEdge(710, w, AUTO_SCROLL_GESTURE_EDGE_RATIO, 190)).toBe(true);
    expect(isInRightEdge(709, w, AUTO_SCROLL_GESTURE_EDGE_RATIO, 190)).toBe(false);
  });

  it('a zero inset (every non-Duo device) is the original zone', () => {
    const w = 1000;
    expect(isInLeftEdge(100, w, BRIGHTNESS_GESTURE_EDGE_RATIO, 0)).toBe(true);
    expect(isInLeftEdge(101, w, BRIGHTNESS_GESTURE_EDGE_RATIO, 0)).toBe(false);
    expect(isInRightEdge(900, w, AUTO_SCROLL_GESTURE_EDGE_RATIO, 0)).toBe(true);
    expect(isInRightEdge(899, w, AUTO_SCROLL_GESTURE_EDGE_RATIO, 0)).toBe(false);
  });
});
