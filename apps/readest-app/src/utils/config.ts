import { ViewSettings } from '@/types/book';

export const getMaxInlineSize = (viewSettings: ViewSettings) => {
  const isVertical = viewSettings.vertical!;
  const screenWidth = window.innerWidth;
  const screenHeight = window.innerHeight;

  return isVertical && false
    ? Math.max(screenWidth, screenHeight, 720)
    : viewSettings.maxInlineSize!;
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
