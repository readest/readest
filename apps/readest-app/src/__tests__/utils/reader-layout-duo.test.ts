import { afterEach, describe, expect, it, vi } from 'vitest';
import { isForcedMobileLayout } from '@/app/reader/utils/mobileLayout';

const setViewport = (innerWidth: number, innerHeight: number) => {
  vi.stubGlobal('window', { innerWidth, innerHeight });
};

afterEach(() => vi.unstubAllGlobals());

// Without the Duo flag the rule is main's: a mobile app at least 640 wide and
// no wider than tall. The viewport size cannot identify the Duo, so nothing
// else may change with it.
describe('isForcedMobileLayout off the Duo', () => {
  it.each([
    ['Android tablet/foldable landscape 960x640', 960, 640],
    ['Android tablet landscape 1024x680', 1024, 680],
    ['iPhone landscape 874x402', 874, 402],
    ['iPad landscape 1180x820', 1180, 820],
    ['phone portrait 393x852', 393, 852],
  ])('is false for %s', (_name, w, h) => {
    setViewport(w, h);
    expect(isForcedMobileLayout(true, false)).toBe(false);
  });

  it.each([
    ['iPad portrait 820x1180', 820, 1180],
    ['iPad mini portrait 744x1133', 744, 1133],
    ['square 700x700', 700, 700],
  ])('is true for %s', (_name, w, h) => {
    setViewport(w, h);
    expect(isForcedMobileLayout(true, false)).toBe(true);
  });

  it('is false on desktop/web', () => {
    setViewport(820, 1180);
    expect(isForcedMobileLayout(false, false)).toBe(false);
    expect(isForcedMobileLayout(undefined, false)).toBe(false);
  });
});

describe('isForcedMobileLayout on the Duo', () => {
  it.each([
    ['inner display landscape 951x669', 951, 669],
    ['inner display portrait 669x951', 669, 951],
    ['cover display landscape 678x466', 678, 466],
  ])('is true for %s: every pose at least 640 wide gets the mobile bars', (_name, w, h) => {
    setViewport(w, h);
    expect(isForcedMobileLayout(true, true)).toBe(true);
  });

  it('is false below the sm breakpoint (cover display portrait 466x678)', () => {
    setViewport(466, 678);
    expect(isForcedMobileLayout(true, true)).toBe(false);
  });

  it('is false for a non-mobile app', () => {
    setViewport(951, 669);
    expect(isForcedMobileLayout(false, true)).toBe(false);
  });
});
