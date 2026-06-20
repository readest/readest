/**
 * Pure helpers for the left-edge swipe-to-adjust-brightness gesture.
 *
 * The gesture reserves the left `BRIGHTNESS_GESTURE_EDGE_RATIO` of the rendered
 * iframe-document width. Once a touch that starts there becomes vertical-dominant
 * past `BRIGHTNESS_GESTURE_ACTIVATION_PX`, finger travel maps to brightness.
 *
 * Brightness math happens in the same perceptual "position" space the menu
 * slider uses (`ColorPanel.tsx`: position = value^0.5, value = position^2), so
 * the gesture, the overlay fill, and the slider all agree.
 */

export const BRIGHTNESS_GESTURE_EDGE_RATIO = 0.1;
export const BRIGHTNESS_GESTURE_ACTIVATION_PX = 18;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

/** True when `clientX` falls within the left edge strip of the view. */
export const isInLeftEdge = (
  clientX: number,
  viewWidth: number,
  edgeRatio = BRIGHTNESS_GESTURE_EDGE_RATIO,
): boolean => viewWidth > 0 && clientX <= viewWidth * edgeRatio;

/** True when movement is vertical-dominant and past the activation threshold. */
export const shouldActivate = (
  deltaX: number,
  deltaY: number,
  threshold = BRIGHTNESS_GESTURE_ACTIVATION_PX,
): boolean => Math.abs(deltaY) >= threshold && Math.abs(deltaY) > Math.abs(deltaX);

/** Perceptual position (0-1) for a brightness value (0-1) — matches the slider. */
export const valueToPosition = (value: number): number => Math.sqrt(clamp01(value));

/** Brightness value (0-1) for a perceptual position (0-1) — matches the slider. */
export const positionToValue = (position: number): number => {
  const p = clamp01(position);
  return clamp01(p * p);
};

/**
 * New brightness value after dragging `deltaY` px from `startValue`.
 *
 * Up (negative `deltaY`) brightens. A full view-height drag spans the whole
 * range. Travel is linear in perceptual position, then converted back to a
 * brightness value so the feel matches the slider. The start is clamped, so an
 * unseeded/`-1` value is safe.
 */
export const computeBrightness = (
  startValue: number,
  deltaY: number,
  viewHeight: number,
): number => {
  if (viewHeight <= 0) return clamp01(startValue);
  const startPos = valueToPosition(clamp01(startValue));
  const nextPos = clamp01(startPos - deltaY / viewHeight);
  return positionToValue(nextPos);
};
