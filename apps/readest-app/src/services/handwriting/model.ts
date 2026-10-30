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

/**
 * Widest page (CSS px) a pen width grows with. Text doesn't grow with the
 * window, so past this the pen keeps its size on screen: on a desktop page
 * the finest pen stays a fine line instead of several px wide (#7094).
 */
export const PEN_MAX_SCALING_WIDTH = 600;

/**
 * A pen draws opaque ink that follows pressure; a marker draws a broad,
 * translucent band of even width, for highlighting what is under it.
 */
export type InkTool = 'pen' | 'marker';

export const DEFAULT_MARKER_COLOR = '#facc15';
export const DEFAULT_MARKER_WIDTH = 0.03;

/** Highlighter colors offered for the marker, in swatch order. */
export const MARKER_COLORS = [
  DEFAULT_MARKER_COLOR,
  '#4ade80',
  '#f472b6',
  '#60a5fa',
  '#fb923c',
] as const;

/** Marker widths as a fraction of page width: about a line of text and up. */
export const MARKER_WIDTHS = [0.02, DEFAULT_MARKER_WIDTH, 0.045] as const;

/** [x, y] or [x, y, pressure]; x/y in 0..1 of the page, pressure in 0..1. */
export type InkPoint = [number, number] | [number, number, number];

export interface InkStroke {
  id: string;
  color: string;
  /** Pen width as a fraction of the page width. */
  width: number;
  /** Set for marker ink; a stroke without it is pen ink. */
  tool?: 'marker';
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

// A sample whose pressure strays this far from the line through its
// neighbours' pressures is kept, so a stroke's swell survives simplification.
const PRESSURE_TOLERANCE = 0.05;

/**
 * How far `p` strays from segment `a`–`b`, relative to the tolerances: its
 * distance from the segment and its pressure against the pressure
 * interpolated there. Above 1 means the sample must be kept.
 */
const deviation = (p: InkPoint, a: InkPoint, b: InkPoint, tol2: number) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const ex = p[0] - (a[0] + t * dx);
  const ey = p[1] - (a[1] + t * dy);
  const spatial = (ex * ex + ey * ey) / tol2;
  if (p[2] === undefined || a[2] === undefined || b[2] === undefined) return spatial;
  const ep = (p[2] - (a[2] + t * (b[2] - a[2]))) / PRESSURE_TOLERANCE;
  return Math.max(spatial, ep * ep);
};

const round = (value: number, digits: number) => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/**
 * Points as they are stored and synced: positions to 1/10000 (a tenth of a
 * pixel on a 1000px page), pressure to 1/100. Full float precision would
 * more than double the size of every drawing for no visible difference.
 */
export const roundPoints = (points: InkPoint[]): InkPoint[] =>
  points.map(([x, y, p]) =>
    p === undefined ? [round(x, 4), round(y, 4)] : [round(x, 4), round(y, 4), round(p, 2)],
  );

/**
 * Ramer–Douglas–Peucker simplification, one stroke at a time.
 *
 * Applied as each stroke is committed: pointer input delivers every coalesced
 * sample, so a page of handwriting would otherwise run to tens of thousands of
 * points. Dropping points within `tolerance` (normalized page units; 0.0002 is
 * a fifth of a pixel on a 1000px page, small enough to keep a letter's loops
 * round) of the line through their neighbours shrinks the stored ink without
 * a visible change. Endpoints always survive, and so does any sample where the
 * pressure changes, with its pressure.
 */
export const simplifyPoints = (points: InkPoint[], tolerance = 0.0002): InkPoint[] => {
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
    let furthestDist = 1;
    for (let i = start + 1; i < end; i++) {
      const d = deviation(points[i]!, points[start]!, points[end]!, tol2);
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
