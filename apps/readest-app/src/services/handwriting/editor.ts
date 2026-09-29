import { HANDWRITING_VERSION, type HandwritingDoc, type InkPoint, type InkStroke } from './model';

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

/**
 * Pure in-memory ink store with per-page undo/redo. Every mutation snapshots
 * the page's stroke list, so add, erase and clear all undo the same way.
 * Strokes are treated as immutable.
 */
export class HandwritingEditor {
  private pages = new Map<string, PageState>();
  private listeners = new Set<() => void>();

  constructor(doc?: HandwritingDoc) {
    for (const [key, page] of Object.entries(doc?.pages ?? {})) {
      this.pages.set(key, { strokes: page.strokes, undo: [], redo: [], updatedAt: page.updatedAt });
    }
  }

  strokes(page: string): readonly InkStroke[] {
    return this.pages.get(page)?.strokes ?? [];
  }

  canUndo(page: string) {
    return (this.pages.get(page)?.undo.length ?? 0) > 0;
  }

  canRedo(page: string) {
    return (this.pages.get(page)?.redo.length ?? 0) > 0;
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
  erase(page: string, path: ArrayLike<InkPoint> | [number, number][], radius: number): number {
    const eraserSegs = segments(path as InkPoint[]);
    if (eraserSegs.length === 0) return 0;
    const kept = this.strokes(page).filter((stroke) => {
      const reach = radius + stroke.width / 2;
      const strokeSegs = segments(stroke.points);
      return !eraserSegs.some((e) => strokeSegs.some((s) => segDist(e, s) <= reach));
    });
    const removed = this.strokes(page).length - kept.length;
    if (removed > 0) this.commit(page, kept);
    return removed;
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

  toDocument(): HandwritingDoc {
    const doc: HandwritingDoc = { version: HANDWRITING_VERSION, pages: {} };
    for (const [key, state] of this.pages) {
      if (state.strokes.length) {
        doc.pages[key] = { strokes: [...state.strokes], updatedAt: state.updatedAt };
      }
    }
    return doc;
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
