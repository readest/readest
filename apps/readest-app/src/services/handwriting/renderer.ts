import type { InkStroke } from './model';
import type { PageRect } from './coords';

// Pressure scales the pen width between MIN_SCALE (feather touch) and 1.
const MIN_SCALE = 0.25;
const pressureScale = (p: number | undefined) => MIN_SCALE + (1 - MIN_SCALE) * (p ?? 1);

/**
 * Redraws `strokes` onto a canvas whose page occupies `rect`. Independent of
 * any input backend; safe to call from requestAnimationFrame.
 */
export const renderStrokes = (
  ctx: CanvasRenderingContext2D,
  strokes: readonly InkStroke[],
  rect: PageRect,
) => {
  const canvas = ctx.canvas as HTMLCanvasElement | undefined;
  ctx.clearRect(
    0,
    0,
    canvas?.width ?? rect.left + rect.width,
    canvas?.height ?? rect.top + rect.height,
  );
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const stroke of strokes) {
    const base = stroke.width * rect.width;
    const pts = stroke.points.map(
      (p) => [rect.left + p[0] * rect.width, rect.top + p[1] * rect.height, p[2]] as const,
    );
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;

    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0]![0], pts[0]![1], (base * pressureScale(pts[0]![2])) / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }

    const hasPressure = pts.some((p) => p[2] !== undefined);
    if (!hasPressure) {
      ctx.lineWidth = base;
      ctx.beginPath();
      ctx.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]![0], pts[i]![1]);
      ctx.stroke();
      continue;
    }

    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      ctx.lineWidth = base * pressureScale(((a[2] ?? 1) + (b[2] ?? 1)) / 2);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }
};
