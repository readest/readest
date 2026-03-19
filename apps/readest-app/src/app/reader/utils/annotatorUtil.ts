import { HIGHLIGHT_COLOR_HEX } from '@/services/constants';
import { HighlightColor } from '@/types/book';
import { SystemSettings } from '@/types/settings';
import { Point } from '@/utils/sel';

export const getHighlightColorHex = (
  settings: SystemSettings,
  color?: HighlightColor,
): string | undefined => {
  if (!color) return undefined;
  if (color.startsWith('#')) return color;
  const customColors = settings.globalReadSettings.customHighlightColors;
  return customColors?.[color] ?? HIGHLIGHT_COLOR_HEX[color];
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
