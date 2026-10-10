/**
 * Platform-neutral handwriting model. Coordinates are page-relative and
 * normalized (0..1) so ink survives zoom, resize and rotation. Nothing in
 * here knows about any vendor SDK.
 */

export const HANDWRITING_VERSION = 1;

/** [x, y] or [x, y, pressure]; x/y in 0..1 of the page, pressure in 0..1. */
export type InkPoint = [number, number] | [number, number, number];

export interface InkStroke {
  id: string;
  color: string;
  /** Pen width as a fraction of the page width. */
  width: number;
  points: InkPoint[];
}

export interface InkPage {
  strokes: InkStroke[];
  updatedAt: number;
}

/**
 * All handwriting of one book. `pages` is keyed by the page key chosen by the
 * reader (PDF page index, or section + page for reflowable books).
 */
export interface HandwritingDoc {
  version: number;
  pages: Record<string, InkPage>;
}

export const emptyHandwriting = (): HandwritingDoc => ({ version: HANDWRITING_VERSION, pages: {} });

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
 * Ink stores every coalesced pointer sample, so a page of handwriting runs to
 * tens of thousands of points. Dropping points that sit within `tolerance`
 * (in normalized page units) of the line through their neighbours shrinks the
 * export substantially without any visible change at reading zoom — the points
 * removed are ones the pen path already passed within a fraction of a pixel of.
 * Endpoints always survive, and pressure is kept on the retained samples so
 * width variation survives too.
 */
const simplifyStroke = (points: InkPoint[], tolerance: number) => {
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

/**
 * Simplify every stroke in a document, for export. `tolerance` is in
 * normalized page units, so 0.001 is roughly a pixel on a 1000px page.
 * Returns the input unchanged when there is nothing to gain.
 */
export const simplifyHandwriting = (doc: HandwritingDoc, tolerance = 0.001): HandwritingDoc => {
  let changed = false;
  const pages: Record<string, InkPage> = {};
  for (const [key, page] of Object.entries(doc.pages)) {
    const strokes = page.strokes.map((stroke) => {
      const points = simplifyStroke(stroke.points, tolerance);
      if (points.length === stroke.points.length) return stroke;
      changed = true;
      return { ...stroke, points };
    });
    pages[key] = { strokes, updatedAt: page.updatedAt };
  }
  return changed ? { version: HANDWRITING_VERSION, pages } : doc;
};

export const serializeHandwriting = (doc: HandwritingDoc): string => JSON.stringify(doc);

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const parsePoint = (raw: unknown): InkPoint | null => {
  if (!Array.isArray(raw) || (raw.length !== 2 && raw.length !== 3)) return null;
  const [x, y, p] = raw as unknown[];
  if (!isNum(x) || !isNum(y)) return null;
  if (raw.length === 2) return [x, y];
  return isNum(p) ? [x, y, p] : null;
};

const parseStroke = (raw: unknown): InkStroke | null => {
  if (!raw || typeof raw !== 'object') return null;
  const { id, color, width, points } = raw as Record<string, unknown>;
  if (typeof id !== 'string' || typeof color !== 'string' || !isNum(width)) return null;
  if (!Array.isArray(points)) return null;
  const parsed: InkPoint[] = [];
  for (const p of points) {
    const pt = parsePoint(p);
    if (!pt) return null;
    parsed.push(pt);
  }
  return { id, color, width, points: parsed };
};

/**
 * Parses a stored document (JSON string or already-decoded object).
 * Missing/malformed input yields an empty document; a document written by a
 * newer schema returns null so callers can leave it untouched rather than
 * overwrite data they cannot read.
 */
export const parseHandwriting = (input: unknown): HandwritingDoc | null => {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch {
      return emptyHandwriting();
    }
  }
  if (!raw || typeof raw !== 'object') return emptyHandwriting();
  const { version, pages } = raw as Record<string, unknown>;
  if (!isNum(version) || !pages || typeof pages !== 'object' || Array.isArray(pages)) {
    return emptyHandwriting();
  }
  if (version > HANDWRITING_VERSION) return null;

  const doc = emptyHandwriting();
  for (const [key, page] of Object.entries(pages as Record<string, unknown>)) {
    if (!page || typeof page !== 'object') continue;
    const { strokes, updatedAt } = page as Record<string, unknown>;
    if (!Array.isArray(strokes)) continue;
    const valid = strokes.map(parseStroke).filter((s): s is InkStroke => s !== null);
    if (valid.length)
      doc.pages[key] = { strokes: valid, updatedAt: isNum(updatedAt) ? updatedAt : 0 };
  }
  return doc;
};
