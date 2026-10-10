/**
 * Platform-neutral handwriting model. Coordinates are page-relative and
 * normalized (0..1) so ink survives zoom, resize and rotation. Nothing in
 * here knows about any vendor SDK.
 */

import type { InkShape } from './anchor';

export const DEFAULT_HANDWRITING_COLOR = '#1a1a1a';
export const DEFAULT_HANDWRITING_WIDTH = 0.006;

/** Ink colors offered in the toolbar, in swatch order. */
export const HANDWRITING_COLORS = [
  DEFAULT_HANDWRITING_COLOR,
  '#1f6feb',
  '#c2410c',
  '#15803d',
  '#9333ea',
] as const;

/**
 * Pen widths as a fraction of page width. The stored value is normalized, so
 * the same setting reads the same relative thickness on any page size.
 */
export const HANDWRITING_WIDTHS = [0.004, DEFAULT_HANDWRITING_WIDTH, 0.01, 0.016] as const;

/** [x, y] or [x, y, pressure]; x/y in 0..1 of the page, pressure in 0..1. */
export type InkPoint = [number, number] | [number, number, number];

export interface InkStroke {
  id: string;
  color: string;
  /** Pen width as a fraction of the page width. */
  width: number;
  /**
   * CFI range of the text or element a reflowable stroke is bound to. When
   * set, `points` are offsets from that content's box (see anchor.ts).
   */
  anchor?: string;
  /** How a pinned stroke morphs on relayout (see anchor.ts); rigid when absent. */
  shape?: InkShape;
  /** Fixed layout: the page (section index) the stroke is drawn on. */
  page?: number;
  /** In memory only: the drawing session (ink annotation id) it belongs to. */
  session?: string;
  points: InkPoint[];
}

export interface InkPage {
  strokes: InkStroke[];
  updatedAt: number;
}

/** Squared distance from `p` to segment `a`–`b`. */
const segDistSq = (p: InkPoint, a: InkPoint, b: InkPoint) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const ex = p[0] - (a[0] + t * dx);
  const ey = p[1] - (a[1] + t * dy);
  return ex * ex + ey * ey;
};

/**
 * Ramer–Douglas–Peucker simplification, one stroke at a time.
 *
 * Applied as each stroke is committed: pointer input delivers every coalesced
 * sample, so a page of handwriting would otherwise run to tens of thousands of
 * points. Dropping points within `tolerance` (normalized page units; 0.001 is
 * about a pixel on a 1000px page) of the line through their neighbours shrinks
 * the stored ink without a visible change. Endpoints always survive, and
 * pressure is kept on the retained samples.
 */
export const simplifyPoints = (points: InkPoint[], tolerance = 0.001): InkPoint[] => {
  if (points.length < 3) return points;
  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  // Explicit stack rather than recursion: a long stroke can nest deeply enough
  // to overflow the JS call stack.
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let furthest = -1;
    let furthestDist = tol2;
    for (let i = start + 1; i < end; i++) {
      const d = segDistSq(points[i]!, points[start]!, points[end]!);
      if (d > furthestDist) {
        furthestDist = d;
        furthest = i;
      }
    }
    if (furthest === -1) continue;
    keep[furthest] = 1;
    stack.push([start, furthest], [furthest, end]);
  }
  const out: InkPoint[] = [];
  for (let i = 0; i < points.length; i++) if (keep[i]) out.push(points[i]!);
  return out;
};
