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
