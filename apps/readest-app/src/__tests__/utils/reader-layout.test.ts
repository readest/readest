import { describe, expect, it } from 'vitest';

import { isForcedMobileLayout } from '@/app/reader/utils/mobileLayout';

const setViewport = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

describe('isForcedMobileLayout', () => {
  it('is false on desktop builds regardless of viewport', () => {
    setViewport(834, 1194);
    expect(isForcedMobileLayout(false)).toBe(false);
    expect(isForcedMobileLayout(undefined)).toBe(false);
  });

  it('is false on phones, which are below the sm breakpoint and already mobile', () => {
    setViewport(390, 844);
    expect(isForcedMobileLayout(true)).toBe(false);
  });

  it('is true on a tablet held portrait, where CSS sees a desktop-width viewport', () => {
    setViewport(834, 1194);
    expect(isForcedMobileLayout(true)).toBe(true);
  });

  it('is false on a tablet held landscape, which gets the desktop footer bar', () => {
    setViewport(1194, 834);
    expect(isForcedMobileLayout(true)).toBe(false);
  });

  it('includes the exact sm breakpoint and a square viewport', () => {
    setViewport(640, 640);
    expect(isForcedMobileLayout(true)).toBe(true);
    setViewport(639, 1000);
    expect(isForcedMobileLayout(true)).toBe(false);
  });

  // iPhone Duo's inner display is landscape-only (951x669) but phone-class on
  // its short side, so without a pose exception it got the desktop
  // hover-reveal chrome while every other pose on the same book got the
  // mobile bars (#6307).
  it('is true on the Duo inner display in landscape (951x669), a phone-class short side', () => {
    setViewport(951, 669);
    expect(isForcedMobileLayout(true)).toBe(true);
  });

  it('is false on an iPad landscape (1180x820), a tablet-class short side', () => {
    setViewport(1180, 820);
    expect(isForcedMobileLayout(true)).toBe(false);
  });

  it('is false on a phone (393x852), below the sm breakpoint', () => {
    setViewport(393, 852);
    expect(isForcedMobileLayout(true)).toBe(false);
  });

  it('is true on tablet portrait (820x1180), already covered by the width<=height case', () => {
    setViewport(820, 1180);
    expect(isForcedMobileLayout(true)).toBe(true);
  });
});
