import type { InkPage, InkPoint, InkStroke } from './model';

interface PageState {
  strokes: InkStroke[];
  undo: InkStroke[][];
  redo: InkStroke[][];
  updatedAt: number;
}

type Seg = [number, number, number, number];

const ccw = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (cy - ay) * (bx - ax) > (by - ay) * (cx - ax);

const intersects = (a: Seg, b: Seg) =>
  ccw(a[0], a[1], b[0], b[1], b[2], b[3]) !== ccw(a[2], a[3], b[0], b[1], b[2], b[3]) &&
  ccw(a[0], a[1], a[2], a[3], b[0], b[1]) !== ccw(a[0], a[1], a[2], a[3], b[2], b[3]);

const pointSegDist = (px: number, py: number, s: Seg) => {
  const dx = s[2] - s[0];
  const dy = s[3] - s[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s[0]) * dx + (py - s[1]) * dy) / len2));
  return Math.hypot(px - (s[0] + t * dx), py - (s[1] + t * dy));
};

const segDist = (a: Seg, b: Seg) =>
  intersects(a, b)
    ? 0
    : Math.min(
        pointSegDist(a[0], a[1], b),
        pointSegDist(a[2], a[3], b),
        pointSegDist(b[0], b[1], a),
        pointSegDist(b[2], b[3], a),
      );

const segments = (pts: ArrayLike<InkPoint>): Seg[] => {
  if (pts.length === 1) return [[pts[0]![0], pts[0]![1], pts[0]![0], pts[0]![1]]];
  const out: Seg[] = [];
  for (let i = 1; i < pts.length; i++) {
    out.push([pts[i - 1]![0], pts[i - 1]![1], pts[i]![0], pts[i]![1]]);
  }
  return out;
};

/** Where a stroke is drawn now, as polylines; null when it isn't shown. */
export type PlaceStroke = (stroke: InkStroke) => InkPoint[][] | null;

const asStored: PlaceStroke = (stroke) => [stroke.points];

/** Whether a path (eraser sweep or tap) comes within `radius` of the placed stroke. */
const touches = (stroke: InkStroke, placed: InkPoint[][], pathSegs: Seg[], radius: number) => {
  const reach = radius + stroke.width / 2;
  return placed.some((points) => {
    const strokeSegs = segments(points);
    return pathSegs.some((e) => strokeSegs.some((s) => segDist(e, s) <= reach));
  });
};

/**
 * Pure in-memory ink store with per-page undo/redo. Every mutation snapshots
 * the page's stroke list, so add, erase and clear all undo the same way.
 * Strokes are treated as immutable.
 */
export class HandwritingEditor {
  private pages = new Map<string, PageState>();
  private listeners = new Set<() => void>();

  constructor(pages?: Record<string, InkPage>) {
    for (const [key, page] of Object.entries(pages ?? {})) {
      this.pages.set(key, { strokes: page.strokes, undo: [], redo: [], updatedAt: page.updatedAt });
    }
  }

  strokes(page: string): readonly InkStroke[] {
    return this.pages.get(page)?.strokes ?? [];
  }

  /** Keys of the pages that currently hold ink. */
  pageKeys(): string[] {
    return [...this.pages].filter(([, state]) => state.strokes.length).map(([key]) => key);
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  addStroke(page: string, stroke: InkStroke) {
    if (stroke.points.length === 0) return;
    this.commit(page, [...this.strokes(page), stroke]);
  }

  /** Removes every stroke touched by the eraser path; returns how many. */
  erase(
    page: string,
    path: ArrayLike<InkPoint> | [number, number][],
    radius: number,
    place: PlaceStroke = asStored,
  ): number {
    const eraserSegs = segments(path as InkPoint[]);
    if (eraserSegs.length === 0) return 0;
    const current = this.strokes(page);
    const kept = current.filter((stroke) => {
      const placed = place(stroke);
      return !placed || !touches(stroke, placed, eraserSegs, radius);
    });
    const removed = current.length - kept.length;
    if (removed > 0) this.commit(page, kept);
    return removed;
  }

  /** Whether any stroke on the page lies within `radius` of the point. */
  hits(page: string, point: InkPoint, radius: number, place: PlaceStroke = asStored): boolean {
    const tap = segments([point]);
    return this.strokes(page).some((stroke) => {
      const placed = place(stroke);
      return !!placed && touches(stroke, placed, tap, radius);
    });
  }

  clear(page: string) {
    if (this.strokes(page).length > 0) this.commit(page, []);
  }

  undo(page: string) {
    const state = this.pages.get(page);
    const prev = state?.undo.pop();
    if (!state || !prev) return;
    state.redo.push(state.strokes);
    state.strokes = prev;
    state.updatedAt = Date.now();
    this.notify();
  }

  redo(page: string) {
    const state = this.pages.get(page);
    const next = state?.redo.pop();
    if (!state || !next) return;
    state.undo.push(state.strokes);
    state.strokes = next;
    state.updatedAt = Date.now();
    this.notify();
  }

  private commit(page: string, strokes: InkStroke[]) {
    const state = this.pages.get(page) ?? { strokes: [], undo: [], redo: [], updatedAt: 0 };
    state.undo.push(state.strokes);
    state.redo = [];
    state.strokes = strokes;
    state.updatedAt = Date.now();
    this.pages.set(page, state);
    this.notify();
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}
