import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import { DEFAULT_HIGHLIGHT_COLORS, HighlightColor } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { Point } from '@/utils/sel';

export const isDefaultHighlightColor = (
  color: HighlightColor,
): color is (typeof DEFAULT_HIGHLIGHT_COLORS)[number] => {
  return (DEFAULT_HIGHLIGHT_COLORS as readonly string[]).includes(color);
};

export const getHighlightColorHex = (
  settings: SystemSettings,
  color?: HighlightColor,
): string | undefined => {
  if (!color) return undefined;
  if (color.startsWith('#')) return color;
  const customColors = settings.globalReadSettings.customHighlightColors;
  return customColors?.[color] ?? HIGHLIGHT_COLOR_HEX[color];
};

/**
 * Returns a user-defined label for the given color, or `undefined` when none is set.
 * Callers that want to fall back to a translated default name should handle that in
 * the component layer (where `useTranslation` is available).
 */
export const getHighlightColorLabel = (
  settings: SystemSettings,
  color: HighlightColor,
): string | undefined => {
  const { defaultHighlightLabels, userHighlightColors } = settings.globalReadSettings;
  if (color.startsWith('#')) {
    const hex = color.trim().toLowerCase();
    const entry = userHighlightColors?.find((c) => c.hex === hex);
    return entry?.label?.trim() || undefined;
  }
  if (isDefaultHighlightColor(color)) {
    return defaultHighlightLabels?.[color]?.trim() || undefined;
  }
  return undefined;
};

export function getExternalDragHandle(
  currentStart: Point,
  currentEnd: Point,
  externalDragPoint?: Point | null,
): 'start' | 'end' | null {
  if (!externalDragPoint) return null;
  const distToStart = Math.hypot(
    externalDragPoint.x - currentStart.x,
    externalDragPoint.y - currentStart.y,
  );
  const distToEnd = Math.hypot(
    externalDragPoint.x - currentEnd.x,
    externalDragPoint.y - currentEnd.y,
  );
  return distToStart < distToEnd ? 'start' : 'end';
}

export function toParentViewportPoint(doc: Document, x: number, y: number): Point {
  const frameElement = doc.defaultView?.frameElement;
  const frameRect = frameElement?.getBoundingClientRect() ?? { top: 0, left: 0 };
  return { x: x + frameRect.left, y: y + frameRect.top };
}
