import type { InkStroke } from './model';
import type { PageRect } from './coords';

// Ordinary pressure (0.5) draws the pen width; a feather touch half of it, a
// firm press half again more. A stroke without pressure draws the pen width.
const pressureScale = (p: number | undefined) => 0.5 + (p ?? 0.5);

// Light enough that the text under a marker stays easy to read.
const MARKER_OPACITY = 0.45;

/** A point on the canvas, with its pressure when it has one. */
type Sample = readonly [number, number, number | undefined];

const midpoint = (a: Sample, b: Sample): Sample => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  a[2] === undefined || b[2] === undefined ? (a[2] ?? b[2]) : (a[2] + b[2]) / 2,
];

type Piece = { from: Sample; via?: Sample; to: Sample };
/** [x, y, radius] */
type Disc = [number, number, number];

// Spacing of the samples along a pen stroke's outline, in CSS px: close
// enough that the outline never shows a facet on a curve.
const STEP = 1.5;

/** Discs along the stroke's curve, sized by the pressure interpolated there. */
const discsAlong = (pieces: Piece[], radius: (p: number | undefined) => number): Disc[] => {
  const discs: Disc[] = [];
  for (const { from, via, to } of pieces) {
    const length = via
      ? Math.hypot(via[0] - from[0], via[1] - from[1]) + Math.hypot(to[0] - via[0], to[1] - via[1])
      : Math.hypot(to[0] - from[0], to[1] - from[1]);
    const n = Math.max(1, Math.ceil(length / STEP));
    for (let k = discs.length ? 1 : 0; k <= n; k++) {
      const t = k / n;
      const [x, y] = via
        ? [
            (1 - t) * (1 - t) * from[0] + 2 * (1 - t) * t * via[0] + t * t * to[0],
            (1 - t) * (1 - t) * from[1] + 2 * (1 - t) * t * via[1] + t * t * to[1],
          ]
        : [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
      const p =
        from[2] === undefined || to[2] === undefined
          ? (from[2] ?? to[2])
          : from[2] + (to[2] - from[2]) * t;
      discs.push([x, y, radius(p)]);
    }
  }
  return discs;
};

/**
 * Traces the outline of a variable-width stroke through `discs` as one
 * closed contour: one side forward, a round cap, the other side back and a
 * round cap. With no inner edges, the fill antialiases only the true edge.
 */
const traceOutline = (ctx: CanvasRenderingContext2D, discs: Disc[]) => {
  const n = discs.length;
  const left: [number, number][] = [];
  const right: [number, number][] = [];
  const angles: number[] = [];
  for (let i = 0; i < n; i++) {
    const [px, py] = discs[Math.max(0, i - 1)]!;
    const [nx, ny] = discs[Math.min(n - 1, i + 1)]!;
    const [x, y, r] = discs[i]!;
    const angle = Math.atan2(ny - py, nx - px);
    angles.push(angle);
    const tx = Math.cos(angle);
    const ty = Math.sin(angle);
    // Where the inner side of a tight turn would fold back on itself, skip
    // the point: a fold would wind the other way and leave a hole.
    const push = (side: [number, number][], sx: number, sy: number) => {
      const last = side[side.length - 1];
      if (last && (sx - last[0]) * tx + (sy - last[1]) * ty < 0) return;
      side.push([sx, sy]);
    };
    push(left, x - ty * r, y + tx * r);
    push(right, x + ty * r, y - tx * r);
  }
  const [ex, ey, er] = discs[n - 1]!;
  const [sx, sy, sr] = discs[0]!;
  const end = angles[n - 1]!;
  const start = angles[0]!;
  ctx.moveTo(left[0]![0], left[0]![1]);
  for (const [x, y] of left) ctx.lineTo(x, y);
  ctx.arc(ex, ey, er, end + Math.PI / 2, end - Math.PI / 2, true);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i]![0], right[i]![1]);
  ctx.arc(sx, sy, sr, start - Math.PI / 2, start - (3 * Math.PI) / 2, true);
  ctx.closePath();
};

/**
 * Redraws `strokes` onto a canvas whose page occupies `rect`; pass
 * `clear: false` to draw another layer over what is there. Independent of any
 * input backend; safe to call from requestAnimationFrame.
 */
export const renderStrokes = (
  ctx: CanvasRenderingContext2D,
  strokes: readonly InkStroke[],
  rect: PageRect,
  clear = true,
) => {
  const canvas = ctx.canvas as HTMLCanvasElement | undefined;
  if (clear) {
    ctx.clearRect(
      0,
      0,
      canvas?.width ?? rect.left + rect.width,
      canvas?.height ?? rect.top + rect.height,
    );
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    const base = stroke.width * rect.width;
    const pts = stroke.points.map(
      (p): Sample => [rect.left + p[0] * rect.width, rect.top + p[1] * rect.height, p[2]],
    );
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;

    const marker = stroke.tool === 'marker';
    if (pts.length === 1) {
      ctx.save();
      if (marker) ctx.globalAlpha = MARKER_OPACITY;
      ctx.beginPath();
      const scale = marker ? 1 : pressureScale(pts[0]![2]);
      ctx.arc(pts[0]![0], pts[0]![1], (base * scale) / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      continue;
    }

    // A smooth curve through the samples: quadratic pieces from midpoint to
    // midpoint, each bending at a sample, so a simplified stroke draws as
    // smoothly as the dense one did while it was being drawn.
    const pieces: Piece[] = [];
    let from: Sample = pts[0]!;
    for (let i = 1; i < pts.length - 1; i++) {
      const to = midpoint(pts[i]!, pts[i + 1]!);
      pieces.push({ from, via: pts[i]!, to });
      from = to;
    }
    pieces.push({ from, to: pts[pts.length - 1]! });

    const smoothPath = () => {
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const { via, to } of pieces) {
        if (via) ctx.quadraticCurveTo(via[0], via[1], to[0], to[1]);
        else ctx.lineTo(to[0], to[1]);
      }
    };

    // A marker is one translucent band of even width with flat ends, stroked
    // as a single path so it does not darken where it crosses itself.
    if (marker) {
      ctx.save();
      ctx.globalAlpha = MARKER_OPACITY;
      ctx.lineCap = 'butt';
      ctx.lineWidth = base;
      smoothPath();
      ctx.stroke();
      ctx.restore();
      continue;
    }

    const hasPressure = pts.some((p) => p[2] !== undefined);
    if (!hasPressure) {
      ctx.lineWidth = base;
      smoothPath();
      ctx.stroke();
      continue;
    }

    // A pen stroke's width follows its pressure, so it is filled as one
    // outline traced around discs every STEP along the curve. Stroking pieces
    // of varying width instead blends their soft edges again at every joint,
    // which reads as a jagged, beaded edge.
    ctx.beginPath();
    traceOutline(
      ctx,
      discsAlong(pieces, (p) => (base * pressureScale(p ?? 0.5)) / 2),
    );
    ctx.fill();
  }
};
