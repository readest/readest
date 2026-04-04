import { BookFormat, FIXED_LAYOUT_FORMATS, ViewSettings } from '@/types/book';

export const FIXED_LAYOUT_READING_RULER_LINE_HEIGHT = 28;

type ReadingRulerSettings = Pick<ViewSettings, 'defaultFontSize' | 'lineHeight'>;

export const calculateReadingRulerSize = (
  lines: number,
  viewSettings: ReadingRulerSettings,
  bookFormat: BookFormat,
): number => {
  if (FIXED_LAYOUT_FORMATS.has(bookFormat)) {
    return lines * FIXED_LAYOUT_READING_RULER_LINE_HEIGHT;
  }

  const fontSize = viewSettings.defaultFontSize || 16;
  const lineHeight = viewSettings.lineHeight || 1.5;
  return Math.round(lines * fontSize * lineHeight);
};

export const clampReadingRulerPosition = (
  position: number,
  dimension: number,
  rulerSize: number,
): number => {
  if (dimension <= 0) return Math.max(0, Math.min(100, position));

  const halfPct = (rulerSize / 2 / dimension) * 100;
  if (halfPct >= 50) return 50;

  return Math.max(halfPct, Math.min(100 - halfPct, position));
};

export const stepReadingRulerPosition = (
  currentPosition: number,
  dimension: number,
  rulerSize: number,
  direction: 'backward' | 'forward',
): number => {
  if (dimension <= 0) {
    return clampReadingRulerPosition(currentPosition, dimension, rulerSize);
  }

  const currentCenter = (currentPosition / 100) * dimension;
  const offset = direction === 'forward' ? rulerSize : -rulerSize;

  return clampReadingRulerPosition(
    ((currentCenter + offset) / dimension) * 100,
    dimension,
    rulerSize,
  );
};

export const getReadingRulerMoveDirection = (
  side: 'left' | 'right' | 'up' | 'down',
  bookDir?: string,
): 'backward' | 'forward' => {
  const normalizedSide =
    bookDir === 'rtl' && (side === 'left' || side === 'right')
      ? side === 'left'
        ? 'right'
        : 'left'
      : side;

  return normalizedSide === 'left' || normalizedSide === 'up' ? 'backward' : 'forward';
};
