import type { InkStroke } from './model';
import type { PageRect } from './coords';

// Ordinary pressure (0.5) draws the pen width; a feather touch half of it, a
// firm press half again more. A stroke without pressure draws the pen width.
const pressureScale = (p: number | undefined) => 0.5 + (p ?? 0.5);

/** A point on the canvas, with its pressure when it has one. */
type Sample = readonly [number, number, number | undefined];

const midpoint = (a: Sample, b: Sample): Sample => [
  (a[0] + b[0]) / 2,
  (a[1] + b[1]) / 2,
  a[2] === undefined || b[2] === undefined ? (a[2] ?? b[2]) : (a[2] + b[2]) / 2,
];

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

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0]![0], pts[0]![1], (base * pressureScale(pts[0]![2])) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    // A smooth curve through the samples: quadratic pieces from midpoint to
    // midpoint, each bending at a sample, so a simplified stroke draws as
    // smoothly as the dense one did while it was being drawn.
    const pieces: { from: Sample; via?: Sample; to: Sample }[] = [];
    let from: Sample = pts[0]!;
    for (let i = 1; i < pts.length - 1; i++) {
      const to = midpoint(pts[i]!, pts[i + 1]!);
      pieces.push({ from, via: pts[i]!, to });
      from = to;
    }
    pieces.push({ from, to: pts[pts.length - 1]! });

    const hasPressure = pts.some((p) => p[2] !== undefined);
    if (!hasPressure) {
      ctx.lineWidth = base;
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (const { via, to } of pieces) {
        if (via) ctx.quadraticCurveTo(via[0], via[1], to[0], to[1]);
        else ctx.lineTo(to[0], to[1]);
      }
      ctx.stroke();
      continue;
    }

    for (const { from, via, to } of pieces) {
      ctx.lineWidth = base * pressureScale(((from[2] ?? 0.5) + (to[2] ?? 0.5)) / 2);
      ctx.beginPath();
      ctx.moveTo(from[0], from[1]);
      if (via) ctx.quadraticCurveTo(via[0], via[1], to[0], to[1]);
      else ctx.lineTo(to[0], to[1]);
      ctx.stroke();
    }
  }
};
