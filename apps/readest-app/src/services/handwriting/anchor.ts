import type { InkPoint } from './model';

export interface AnchorBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * How a pinned stroke morphs when its content is laid out again, chosen from
 * the stroke's shape when it is drawn:
 *
 * - `flow`: an underline or strike-through. Each point keeps its position
 *   along the marked text and its offset from its line, so the mark follows
 *   the words across a re-wrap, split into one piece per line.
 * - `box`: a circle, box or scribble over content. Fitted to the covered
 *   content's new box, keeping its shape and topology.
 * - `spanL` / `spanR`: a bracket or bar beside a paragraph. Stretched
 *   vertically to the lines beside it, kept at its distance from the text's
 *   left or right edge.
 * - none: a margin note. Moves rigidly with the nearest character and scales
 *   with the font without distortion.
 */
export type InkShape = 'flow' | 'box' | 'spanL' | 'spanR';

const withPressure = (point: InkPoint, p: number | undefined): InkPoint =>
  p === undefined ? point : [point[0], point[1], p];

export const boundsOf = (points: InkPoint[]): AnchorBox => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
};

const union = (a: AnchorBox, b: AnchorBox): AnchorBox => {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
};

/**
 * A range's line boxes, in reading order, up to its first column break. A
 * range that wraps onto the next page continues at the top of another column;
 * stopping there keeps ink to the lines shown together, so it can't be
 * stretched across two pages.
 */
export const columnLines = (rects: AnchorBox[]): AnchorBox[] => {
  const lines: AnchorBox[] = [];
  for (const r of rects) {
    if (!r.width && !r.height) continue;
    const last = lines[lines.length - 1];
    if (last && r.top < last.top - r.height / 2) break;
    const sameLine =
      last &&
      Math.abs(r.top + r.height / 2 - (last.top + last.height / 2)) <
        Math.max(r.height, last.height) / 2;
    if (sameLine) lines[lines.length - 1] = union(last, r);
    else lines.push({ ...r });
  }
  return lines;
};

export const columnBox = (rects: AnchorBox[]): AnchorBox | null => {
  const lines = columnLines(rects);
  return lines.length ? lines.reduce(union) : null;
};

/** Even-odd test against the stroke's path, closed from its end back to its start. */
const insidePath = (x: number, y: number, path: InkPoint[]) => {
  let inside = false;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
    const [xi, yi] = path[i]!;
    const [xj, yj] = path[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** Grid points inside the area a stroke encloses: what a circle or box marks. */
export const interiorSamples = (path: InkPoint[], grid = 7): InkPoint[] => {
  const box = boundsOf(path);
  if (!box.width || !box.height) return [];
  const samples: InkPoint[] = [];
  for (let i = 1; i < grid; i++) {
    for (let j = 1; j < grid; j++) {
      const x = box.left + (box.width * i) / grid;
      const y = box.top + (box.height * j) / grid;
      if (insidePath(x, y, path)) samples.push([x, y]);
    }
  }
  return samples;
};

/** The morph for a new stroke, from its bounds, the line height and what it covers. */
export const classifyShape = (
  stroke: AnchorBox,
  lineHeight: number,
  covers: boolean,
): 'flow' | 'box' | 'span' | undefined => {
  if (covers) {
    return stroke.height <= lineHeight * 0.9 && stroke.width >= lineHeight * 1.5 ? 'flow' : 'box';
  }
  return stroke.height >= lineHeight * 2 && stroke.width <= stroke.height * 0.5
    ? 'span'
    : undefined;
};

/**
 * The morph to place a stroke with. Strokes carry their shape; without one,
 * a stroke bound to a single character is a rigid note and one bound to a
 * wider range is fitted to its box (how ink was pinned before shapes).
 */
export const effectiveShape = (
  shape: InkShape | undefined,
  singleCharacter: boolean,
): InkShape | undefined => shape ?? (singleCharacter ? undefined : 'box');

/** Rigid: offsets from a character's box in units of its height. */
export const toAnchorBox = (points: InkPoint[], box: AnchorBox): InkPoint[] =>
  points.map(([x, y, p]) =>
    withPressure([(x - box.left) / box.height, (y - box.top) / box.height], p),
  );

export const fromAnchorBox = (points: InkPoint[], box: AnchorBox): InkPoint[] =>
  points.map(([x, y, p]) => withPressure([box.left + x * box.height, box.top + y * box.height], p));

/** Box: normalized to the covered content's box. */
export const fitToBox = (points: InkPoint[], box: AnchorBox): InkPoint[] =>
  points.map(([x, y, p]) =>
    withPressure([(x - box.left) / box.width, (y - box.top) / box.height], p),
  );

export const fitFromBox = (points: InkPoint[], box: AnchorBox): InkPoint[] =>
  points.map(([u, v, p]) => withPressure([box.left + u * box.width, box.top + v * box.height], p));

const lineStarts = (lines: AnchorBox[]) => {
  const starts: number[] = [];
  let total = 0;
  for (const line of lines) {
    starts.push(total);
    total += line.width;
  }
  return { starts, total };
};

/** Flow: [position along the text (0..1), offset from its line in line heights]. */
export const toFlow = (points: InkPoint[], lines: AnchorBox[]): InkPoint[] => {
  const { starts, total } = lineStarts(lines);
  return points.map(([x, y, p]) => {
    let i = 0;
    for (let j = 1; j < lines.length; j++) {
      const centre = (l: AnchorBox) => Math.abs(y - (l.top + l.height / 2));
      if (centre(lines[j]!) < centre(lines[i]!)) i = j;
    }
    const line = lines[i]!;
    return withPressure([(starts[i]! + x - line.left) / total, (y - line.top) / line.height], p);
  });
};

/**
 * Flow back onto the current lines; one polyline per line the mark now spans.
 * Where the mark breaks across lines, each piece runs to its line's edge.
 */
export const fromFlow = (points: InkPoint[], lines: AnchorBox[]): InkPoint[][] => {
  const { starts, total } = lineStarts(lines);
  const polylines: InkPoint[][] = [];
  let current = -1;
  let lastV = 0;
  for (const [t, v, p] of points) {
    const at = t * total;
    let i = 0;
    while (i + 1 < lines.length && at >= starts[i + 1]!) i++;
    const line = lines[i]!;
    if (i !== current) {
      const prev = lines[current];
      const forward = i > current;
      if (prev) {
        const edge = forward ? prev.left + prev.width : prev.left;
        polylines[polylines.length - 1]!.push([edge, prev.top + lastV * prev.height]);
      }
      polylines.push(
        prev ? [[forward ? line.left : line.left + line.width, line.top + v * line.height]] : [],
      );
      current = i;
    }
    polylines[polylines.length - 1]!.push(
      withPressure([line.left + at - starts[i]!, line.top + v * line.height], p),
    );
    lastV = v;
  }
  return polylines;
};

/** Points every `step` along the path, so a flow mark can follow re-wrapped text. */
export const densify = (points: InkPoint[], step: number): InkPoint[] => {
  if (points.length < 2 || step <= 0) return points;
  const out: InkPoint[] = [points[0]!];
  for (let i = 1; i < points.length; i++) {
    const [x0, y0, p0] = points[i - 1]!;
    const [x1, y1, p1] = points[i]!;
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const point: InkPoint = [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
      out.push(
        p0 === undefined || p1 === undefined ? point : [point[0], point[1], p0 + (p1 - p0) * f],
      );
    }
  }
  return out;
};

/** Span: [offset from the text edge in line heights, position down the lines (0..1)]. */
export const toSpan = (
  points: InkPoint[],
  box: AnchorBox,
  lineHeight: number,
  side: 'spanL' | 'spanR',
): InkPoint[] => {
  const edge = side === 'spanL' ? box.left : box.left + box.width;
  return points.map(([x, y, p]) =>
    withPressure([(x - edge) / lineHeight, (y - box.top) / box.height], p),
  );
};

export const fromSpan = (
  points: InkPoint[],
  box: AnchorBox,
  lineHeight: number,
  side: 'spanL' | 'spanR',
): InkPoint[] => {
  const edge = side === 'spanL' ? box.left : box.left + box.width;
  return points.map(([u, v, p]) =>
    withPressure([edge + u * lineHeight, box.top + v * box.height], p),
  );
};

/** Binds strokes to the content they mark and places them in the current layout. */
export interface InkAnchoring {
  /** Pin page-normalized points to the content they mark (a note may join `reuse`). */
  pin(
    points: InkPoint[],
    reuse?: string,
  ): { anchor: string; shape?: InkShape; points: InkPoint[] } | null;
  /** Page-normalized polylines of a pinned stroke now; null when its content isn't laid out. */
  place(stroke: { anchor?: string; shape?: InkShape; points: InkPoint[] }): InkPoint[][] | null;
}
