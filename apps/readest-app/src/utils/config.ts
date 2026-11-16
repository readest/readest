import { ViewSettings } from '@/types/book';
import { getOSPlatform } from '@/utils/misc';

/**
 * Whether a near-square *window* should reduce the reader's own max inline size.
 *
 * The 0.8 factor below is for unfolded foldables and tablets, where a
 * full-width single column is too wide to read. It is evaluated from the window
 * on every platform, so a desktop window that merely happens to be near-square
 * is reduced as well -- and because the factor depends on the window size, a
 * book opened in such a window keeps the reduced ceiling after the window
 * grows, which leaves a band on both sides until a setting is nudged.
 *
 * On a desktop the window is the user's to size and the setting is a number
 * they chose, so it is honoured verbatim there. `getOSPlatform` reports iPadOS
 * in desktop mode as `macos`; that is harmless, its ratios (4:3 and the
 * split-view halves) sit outside the band anyway.
 */
// Keyed on the user agent rather than resolved once: `getMaxInlineSize` runs on
// every layout pass and the regexes in `getOSPlatform` are wasted work there,
// but a cached *answer* would outlive a test that stubs another platform.
let trimsNearSquareScreenCache: { userAgent: string; trims: boolean } | null = null;

const trimsNearSquareScreen = () => {
  if (typeof navigator === 'undefined') return false;
  const userAgent = navigator.userAgent;
  if (trimsNearSquareScreenCache?.userAgent !== userAgent) {
    const os = getOSPlatform();
    trimsNearSquareScreenCache = {
      userAgent,
      trims: os !== 'windows' && os !== 'macos' && os !== 'linux',
    };
  }
  return trimsNearSquareScreenCache.trims;
};

export const getMaxInlineSize = (viewSettings: ViewSettings) => {
  const isVertical = viewSettings.vertical;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  const screenAspectRatio = isVertical ? screenHeight / screenWidth : screenWidth / screenHeight;
  const isUnfoldedScreen =
    trimsNearSquareScreen() &&
    screenAspectRatio < 1.3 &&
    screenAspectRatio > 0.77 &&
    screenWidth > 600;

  return isVertical
    ? Math.max(screenWidth, screenHeight, 720, viewSettings.maxInlineSize)
    : isUnfoldedScreen
      ? viewSettings.maxInlineSize * 0.8
      : viewSettings.maxInlineSize;
};

/**
 * Whether the paginator will lay the page out as a two-column spread,
 * mirroring its column count: min(maxColumnCount, ceil(width / maxInlineSize)).
 */
export const expectsColumnSpread = (
  viewSettings: ViewSettings,
  pageWidth: number,
  layout = {
    maxColumnCount: viewSettings.maxColumnCount,
    maxInlineSize: getMaxInlineSize(viewSettings),
  },
) => {
  if (viewSettings.scrolled || viewSettings.vertical) return false;
  const columns = Math.min(
    layout.maxColumnCount,
    Math.ceil(Math.floor(pageWidth) / Math.floor(layout.maxInlineSize)),
  );
  return columns > 1;
};

export const getDefaultMaxInlineSize = () => {
  if (typeof window === 'undefined') return 720;

  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  return screenWidth < screenHeight ? Math.max(screenWidth, 720) : 720;
};

export const getDefaultMaxBlockSize = () => {
  if (typeof window === 'undefined') return 1440;

  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;
  return Math.max(screenWidth, screenHeight, 1440);
};
