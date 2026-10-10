import type { InkPoint } from './model';

export interface AnchorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Ink near content but not over it (margin notes) is bound to the nearest
 * character and stored relative to that character's box in units of its
 * height, so it follows its text and scales with the font without distortion.
 */
export const toAnchorBox = (points: InkPoint[], box: AnchorBox): InkPoint[] =>
  points.map(([x, y, p]): InkPoint => {
    const offset: InkPoint = [(x - box.left) / box.height, (y - box.top) / box.height];
    return p === undefined ? offset : [offset[0], offset[1], p];
  });

export const fromAnchorBox = (points: InkPoint[], box: AnchorBox): InkPoint[] =>
  points.map(([x, y, p]): InkPoint => {
    const point: InkPoint = [box.left + x * box.height, box.top + y * box.height];
    return p === undefined ? point : [point[0], point[1], p];
  });

/**
 * Ink drawn over content is bound to the range of words and elements it
 * covers and stored normalized to that range's box. Re-fitting it to the
 * range's current box keeps its shape and topology (a circle stays around its
 * words, an underline under them) through font, size and line-height changes.
 */
export const fitToBox = (points: InkPoint[], box: AnchorBox): InkPoint[] =>
  points.map(([x, y, p]): InkPoint => {
    const fit: InkPoint = [(x - box.left) / box.width, (y - box.top) / box.height];
    return p === undefined ? fit : [fit[0], fit[1], p];
  });

export const fitFromBox = (points: InkPoint[], box: AnchorBox): InkPoint[] =>
  points.map(([u, v, p]): InkPoint => {
    const point: InkPoint = [box.left + u * box.width, box.top + v * box.height];
    return p === undefined ? point : [point[0], point[1], p];
  });

/** Binds strokes to the content under them and places them in the current layout. */
export interface InkAnchoring {
  /** Pin page-normalized points to the content under them (or to `reuse`). */
  pin(points: InkPoint[], reuse?: string): { anchor: string; points: InkPoint[] } | null;
  /** Page-normalized points of a pinned stroke now; null when its content isn't laid out. */
  place(stroke: { anchor?: string; points: InkPoint[] }): InkPoint[] | null;
}
