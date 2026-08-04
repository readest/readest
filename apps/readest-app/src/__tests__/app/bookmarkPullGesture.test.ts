import { describe, it, expect } from 'vitest';
import {
  BOOKMARK_PULL_ACTIVATION_PX,
  BOOKMARK_PULL_TRIGGER_PX,
  BOOKMARK_PULL_LINEAR_PX,
  BOOKMARK_PULL_DAMPING,
  shouldActivatePull,
  computePullOffset,
  isPastPullThreshold,
  previewRibbonFilled,
  pullRibbonHeight,
  pullHintShift,
  canPullBookmark,
} from '@/app/reader/utils/bookmarkPullGesture';

describe('bookmarkPullGesture pure helpers', () => {
  describe('shouldActivatePull', () => {
    it('activates only on a downward-dominant move past the threshold', () => {
      const t = BOOKMARK_PULL_ACTIVATION_PX;
      expect(shouldActivatePull(0, t)).toBe(true); // exactly at threshold, straight down
      expect(shouldActivatePull(0, t - 1)).toBe(false); // below threshold
      expect(shouldActivatePull(10, t + 10)).toBe(true); // down-dominant
    });

    it('never activates on upward moves (unlike brightness, direction matters)', () => {
      expect(shouldActivatePull(0, -BOOKMARK_PULL_ACTIVATION_PX)).toBe(false);
      expect(shouldActivatePull(0, -200)).toBe(false);
    });

    it('does not activate on horizontal-dominant or tie moves', () => {
      const t = BOOKMARK_PULL_ACTIVATION_PX;
      expect(shouldActivatePull(t + 5, t + 4)).toBe(false); // horizontal-dominant
      expect(shouldActivatePull(t, t)).toBe(false); // tie is not "> "
      expect(shouldActivatePull(-(t + 5), t + 4)).toBe(false); // magnitude counts for dx
    });
  });

  describe('computePullOffset', () => {
    it('tracks the finger 1:1 through the linear range (which covers the trigger)', () => {
      expect(computePullOffset(0)).toBe(0);
      expect(computePullOffset(50)).toBe(50);
      expect(computePullOffset(BOOKMARK_PULL_TRIGGER_PX)).toBe(BOOKMARK_PULL_TRIGGER_PX);
      expect(computePullOffset(BOOKMARK_PULL_LINEAR_PX)).toBe(BOOKMARK_PULL_LINEAR_PX);
      expect(BOOKMARK_PULL_LINEAR_PX).toBeGreaterThanOrEqual(BOOKMARK_PULL_TRIGGER_PX);
    });

    it('rubber-bands past the linear range', () => {
      const dy = BOOKMARK_PULL_LINEAR_PX + 100;
      expect(computePullOffset(dy)).toBeCloseTo(
        BOOKMARK_PULL_LINEAR_PX + 100 * BOOKMARK_PULL_DAMPING,
        10,
      );
      // still monotonic
      expect(computePullOffset(dy + 1)).toBeGreaterThan(computePullOffset(dy));
    });

    it('clamps upward drags to zero', () => {
      expect(computePullOffset(-1)).toBe(0);
      expect(computePullOffset(-500)).toBe(0);
    });
  });

  describe('isPastPullThreshold', () => {
    it('flips exactly at the trigger distance', () => {
      expect(isPastPullThreshold(BOOKMARK_PULL_TRIGGER_PX - 1)).toBe(false);
      expect(isPastPullThreshold(BOOKMARK_PULL_TRIGGER_PX)).toBe(true);
    });
  });

  describe('previewRibbonFilled', () => {
    it('always previews the post-release bookmark state', () => {
      // bookmarked, below threshold: release does nothing -> stays bookmarked -> filled
      expect(previewRibbonFilled(true, false)).toBe(true);
      // bookmarked, past threshold: release removes -> outline
      expect(previewRibbonFilled(true, true)).toBe(false);
      // not bookmarked, below threshold: release does nothing -> outline
      expect(previewRibbonFilled(false, false)).toBe(false);
      // not bookmarked, past threshold: release adds -> filled
      expect(previewRibbonFilled(false, true)).toBe(true);
    });
  });

  describe('pullRibbonHeight', () => {
    it('hangs at rest height until the page edge passes it, then rides the edge', () => {
      expect(pullRibbonHeight(0, 92)).toBe(92);
      expect(pullRibbonHeight(60, 92)).toBe(92);
      expect(pullRibbonHeight(92, 92)).toBe(92);
      expect(pullRibbonHeight(150, 92)).toBe(150);
    });
  });

  describe('pullHintShift', () => {
    const hintHeight = 20;
    const pinTop = 55;
    it('rides the page edge (no shift) until the hint reaches the pin position', () => {
      expect(pullHintShift(0, hintHeight, pinTop)).toBe(0);
      expect(pullHintShift(hintHeight + pinTop, hintHeight, pinTop)).toBe(0);
    });

    it('pins: shifts up by exactly the overshoot once past the pin position', () => {
      expect(pullHintShift(hintHeight + pinTop + 40, hintHeight, pinTop)).toBe(-40);
      expect(pullHintShift(hintHeight + pinTop + 1, hintHeight, pinTop)).toBe(-1);
    });
  });

  describe('canPullBookmark', () => {
    const eligible = { scrolled: false, vertical: false, isEink: false, isFixedLayout: false };
    it('allows only paginated reflowable horizontal-writing non-eink books', () => {
      expect(canPullBookmark(eligible)).toBe(true);
      expect(canPullBookmark({ ...eligible, scrolled: true })).toBe(false);
      expect(canPullBookmark({ ...eligible, vertical: true })).toBe(false);
      expect(canPullBookmark({ ...eligible, isEink: true })).toBe(false);
      expect(canPullBookmark({ ...eligible, isFixedLayout: true })).toBe(false);
    });
  });
});
