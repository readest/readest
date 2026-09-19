/**
 * Pure helpers for the right-edge swipe-to-adjust-auto-scroll-speed gesture.
 *
 * Mirrors the left-edge brightness gesture (`brightnessGesture.ts`) but on the
 * opposite edge and only while an Auto Scroll session is active. The gesture
 * reserves the right `AUTO_SCROLL_GESTURE_EDGE_RATIO` of the rendered
 * iframe-document width; once a touch that starts there becomes
 * vertical-dominant past `AUTO_SCROLL_GESTURE_ACTIVATION_PX`, finger travel maps
 * linearly onto the speed range and snaps to `AUTO_SCROLL_SPEED_STEP` so the
 * gesture and the −/+ pill land on the same values.
 */

import {
  AUTO_SCROLL_SPEED_STEP,
  MAX_AUTO_SCROLL_SPEED,
  MIN_AUTO_SCROLL_SPEED,
} from '@/services/constants';

export const AUTO_SCROLL_GESTURE_EDGE_RATIO = 0.1;
export const AUTO_SCROLL_GESTURE_ACTIVATION_PX = 18;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));

const clampSpeed = (speed: number): number =>
  Math.max(MIN_AUTO_SCROLL_SPEED, Math.min(MAX_AUTO_SCROLL_SPEED, speed));

/**
 * True when `clientX` falls within the right edge strip of the view.
 *
 * `edgeInset` pulls the zone's start in from the physical edge, past a
 * vertical system strip — iPhone Duo reports its status-bar strip as a large
 * left/right safe-area inset (#6307) — so the gesture doesn't arm underneath
 * it.
 */
export const isInRightEdge = (
  clientX: number,
  viewWidth: number,
  edgeRatio = AUTO_SCROLL_GESTURE_EDGE_RATIO,
  edgeInset = 0,
): boolean => viewWidth > 0 && clientX >= viewWidth * (1 - edgeRatio) - edgeInset;

/** True when movement is vertical-dominant and past the activation threshold. */
export const shouldActivate = (
  deltaX: number,
  deltaY: number,
  threshold = AUTO_SCROLL_GESTURE_ACTIVATION_PX,
): boolean => Math.abs(deltaY) >= threshold && Math.abs(deltaY) > Math.abs(deltaX);

/** Perceptual position (0-1) for a speed, linear across [min, max]. */
export const speedToPosition = (speed: number): number =>
  clamp01(
    (clampSpeed(speed) - MIN_AUTO_SCROLL_SPEED) / (MAX_AUTO_SCROLL_SPEED - MIN_AUTO_SCROLL_SPEED),
  );

/**
 * New speed after dragging `deltaY` px from `startSpeed`.
 *
 * Up (negative `deltaY`) speeds up. A full view-height drag spans the whole
 * range. Travel is linear in position, then converted back to a speed and
 * snapped to the step so it matches the pill's increments.
 */
export const computeSpeed = (startSpeed: number, deltaY: number, viewHeight: number): number => {
  if (viewHeight <= 0) return clampSpeed(startSpeed);
  const startPos = speedToPosition(startSpeed);
  const nextPos = clamp01(startPos - deltaY / viewHeight);
  const raw = MIN_AUTO_SCROLL_SPEED + nextPos * (MAX_AUTO_SCROLL_SPEED - MIN_AUTO_SCROLL_SPEED);
  return clampSpeed(Math.round(raw / AUTO_SCROLL_SPEED_STEP) * AUTO_SCROLL_SPEED_STEP);
};
