import { HANDWRITING_VERSION, type HandwritingDoc, type InkPoint, type InkStroke } from './model';

interface PageState {
  strokes: InkStroke[];
  updatedAt: number;
}

/** Page keys with the stroke lists one edit replaced. */
type Snapshot = [string, InkStroke[]][];

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

/** Whether a path (eraser sweep or tap) comes within `radius` of the stroke. */
const touches = (stroke: InkStroke, pathSegs: Seg[], radius: number) => {
  const reach = radius + stroke.width / 2;
  const strokeSegs = segments(stroke.points);
  return pathSegs.some((e) => strokeSegs.some((s) => segDist(e, s) <= reach));
};

/**
 * Pure in-memory ink store with undo/redo. History is kept per page the edits
 * were made from, and one step can span the other anchors shown on that page
 * (`also`), so an erase across them undoes as one gesture. Strokes are
 * treated as immutable.
 */
export class HandwritingEditor {
  private pages = new Map<string, PageState>();
  private history = new Map<string, { undo: Snapshot[]; redo: Snapshot[] }>();
  private listeners = new Set<() => void>();

  constructor(doc?: HandwritingDoc) {
    for (const [key, page] of Object.entries(doc?.pages ?? {})) {
      this.pages.set(key, { strokes: page.strokes, updatedAt: page.updatedAt });
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
    this.commit(page, [[page, [...this.strokes(page), stroke]]]);
  }

  /** Removes every stroke touched by the eraser path; returns how many. */
  erase(
    page: string,
    path: ArrayLike<InkPoint> | [number, number][],
    radius: number,
    also: string[] = [],
  ): number {
    const eraserSegs = segments(path as InkPoint[]);
    if (eraserSegs.length === 0) return 0;
    let removed = 0;
    const changes: Snapshot = [];
    for (const key of [page, ...also]) {
      const current = this.strokes(key);
      const kept = current.filter((stroke) => !touches(stroke, eraserSegs, radius));
      if (kept.length === current.length) continue;
      removed += current.length - kept.length;
      changes.push([key, kept]);
    }
    if (changes.length) this.commit(page, changes);
    return removed;
  }

  /** Whether any stroke on these pages lies within `radius` of the point. */
  hits(pages: string[], point: InkPoint, radius: number): boolean {
    const tap = segments([point]);
    return pages.some((page) => this.strokes(page).some((stroke) => touches(stroke, tap, radius)));
  }

  clear(page: string, also: string[] = []) {
    const changes: Snapshot = [page, ...also]
      .filter((key) => this.strokes(key).length > 0)
      .map((key) => [key, []]);
    if (changes.length) this.commit(page, changes);
  }

  undo(page: string) {
    this.step(page, 'undo', 'redo');
  }

  redo(page: string) {
    this.step(page, 'redo', 'undo');
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

  private commit(page: string, changes: Snapshot) {
    const history = this.history.get(page) ?? { undo: [], redo: [] };
    history.undo.push(this.apply(changes));
    history.redo = [];
    this.history.set(page, history);
    this.notify();
  }

  private step(page: string, from: 'undo' | 'redo', to: 'undo' | 'redo') {
    const history = this.history.get(page);
    const snapshot = history?.[from].pop();
    if (!history || !snapshot) return;
    history[to].push(this.apply(snapshot));
    this.notify();
  }

  /** Writes new stroke lists and returns the ones they replaced. */
  private apply(changes: Snapshot): Snapshot {
    return changes.map(([key, strokes]) => {
      const previous = [...this.strokes(key)];
      this.pages.set(key, { strokes, updatedAt: Date.now() });
      return [key, previous];
    });
  }

  private notify() {
    for (const fn of this.listeners) fn();
  }
}
