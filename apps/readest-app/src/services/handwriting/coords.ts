export interface PageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Screen (CSS px) → normalized page coordinates. The rect is the page's
 * current on-screen bounds, so scroll, zoom, resize and rotation are all
 * absorbed by whoever measures the rect; persisted ink never sees them.
 */
export const screenToPage = (p: Point2D, rect: PageRect, opts?: { clamp?: boolean }): Point2D => {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 };
  let x = (p.x - rect.left) / rect.width;
  let y = (p.y - rect.top) / rect.height;
  if (opts?.clamp) {
    x = Math.min(1, Math.max(0, x));
    y = Math.min(1, Math.max(0, y));
  }
  return { x, y };
};

export const pageToScreen = (p: Point2D, rect: PageRect): Point2D => ({
  x: rect.left + p.x * rect.width,
  y: rect.top + p.y * rect.height,
});
