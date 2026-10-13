import { ViewSettings } from '@/types/book';

export const getMaxInlineSize = (viewSettings: ViewSettings) => {
  const isVertical = viewSettings.vertical;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  const screenAspectRatio = isVertical ? screenHeight / screenWidth : screenWidth / screenHeight;
  const isUnfoldedScreen = screenAspectRatio < 1.3 && screenAspectRatio > 0.77 && screenWidth > 600;

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
export const expectsColumnSpread = (viewSettings: ViewSettings, pageWidth: number) => {
  if (viewSettings.scrolled || viewSettings.vertical) return false;
  const columns = Math.min(
    viewSettings.maxColumnCount,
    Math.ceil(Math.floor(pageWidth) / Math.floor(getMaxInlineSize(viewSettings))),
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
