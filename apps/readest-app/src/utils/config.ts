import { ViewSettings } from '@/types/book';
import { getOSPlatform } from '@/utils/misc';

/**
 * Whether a near-square window trims the reader's max inline size. The 0.8
 * factor is for unfolded foldables, tablets and split screen, where a
 * full-width column is too wide to read. A desktop window is one the user
 * sized, so the setting is kept verbatim there (#7510). iPadOS reports a
 * desktop ("Macintosh") user agent; touch points give it away.
 */
const trimsNearSquareScreen = () => {
  if (typeof navigator === 'undefined') return false;
  const os = getOSPlatform();
  if (os === 'macos') return navigator.maxTouchPoints > 1;
  return os !== 'windows' && os !== 'linux';
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
