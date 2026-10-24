// Paper model derived from eBoox 2.63's PageCurlGLSurface renderer:
// 64 parallel hinges, each rotating PI/65, over 0.7 of the leaf width.
// Clip at the hinges before deforming: a fixed rectangular grid cuts across
// diagonal creases and makes the paper wobble as those creases move.
type Point = [number, number];
const HINGES = 64;
const ANGLE = Math.PI / (HINGES + 1);

/** Clip the source leaf at each hinge and emit perspective-ready textured triangles. */
export function buildPageCurlMesh(
  width: number,
  height: number,
  progress: number,
  grabY: number,
  rtl: boolean,
  columns: number,
  includeInnerColumn = true,
): Float32Array {
  const p = Math.max(0, Math.min(1, progress));
  const spread = columns >= 2;
  const leafWidth = spread ? width / 2 : width;
  const origin = width - leafWidth;
  const bend = 0.7 * leafWidth * (spread ? 1 - p * p : 1);
  // grabY encodes 0.5 + vertical finger displacement / page height.
  // eBoox biases a stationary finger by 10% of the page height.
  const slope = (0.2 - 2 * (grabY - 0.5)) * (1 - p);
  const norm = Math.hypot(1, slope);
  const nx = 1 / norm;
  const ny = slope / norm;
  const fold = leafWidth - (leafWidth + bend) * p;
  const step = bend / HINGES / norm;
  const vertices: number[] = [];
  const distance = ([x, y]: Point) => (x - fold) * nx + (y - height / 2) * ny;

  const clip = (polygon: Point[], edge: number, above: boolean): Point[] => {
    const result: Point[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i]!;
      const b = polygon[(i + 1) % polygon.length]!;
      const da = distance(a) - edge;
      const db = distance(b) - edge;
      const insideA = above ? da >= 0 : da <= 0;
      const insideB = above ? db >= 0 : db <= 0;
      if (insideA) result.push(a);
      if (insideA !== insideB) {
        const t = da / (da - db);
        result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return result;
  };

  const vertex = ([x, y]: Point, deform: boolean) => {
    const sourceX = origin + x;
    let px = sourceX;
    let py = y;
    let z = 0;
    let shade = 0;
    const s = distance([x, y]);
    if (deform && p > 0 && s > 0) {
      if (step < 1e-6) {
        px -= 2 * s * nx;
        py -= 2 * s * ny;
      } else {
        const turns = Math.min(HINGES, Math.floor(s / step + 1e-7));
        const angle = turns * ANGLE;
        // Sum the 64 rigid strips analytically; the remaining distance is
        // on the last strip (or on the flat, fully turned back).
        const sum = (step * Math.sin(angle / 2)) / Math.sin(ANGLE / 2);
        const bentX = sum * Math.cos((angle - ANGLE) / 2) + (s - turns * step) * Math.cos(angle);
        z = sum * Math.sin((angle - ANGLE) / 2) + (s - turns * step) * Math.sin(angle);
        px -= (s - bentX) * nx;
        py -= (s - bentX) * ny;
        const band = Math.min(HINGES, s / step);
        shade = Math.max(0, 0.25 - Math.abs(0.25 - band / 128));
      }
    }
    // UV, deformed page position, and the hinge shading coefficient.
    vertices.push(
      (rtl ? width - sourceX : sourceX) / width,
      y / height,
      rtl ? width - px : px,
      py,
      z,
      shade,
    );
  };
  const emit = (polygon: Point[], deform: boolean) => {
    for (let i = 1; i + 1 < polygon.length; i++) {
      for (const point of [polygon[0]!, polygon[i]!, polygon[i + 1]!]) vertex(point, deform);
    }
  };
  const rect: Point[] = [
    [0, 0],
    [leafWidth, 0],
    [leafWidth, height],
    [0, height],
  ];
  if (spread && includeInnerColumn)
    emit(
      [
        [-origin, 0],
        [0, 0],
        [0, height],
        [-origin, height],
      ],
      false,
    );
  if (p === 0) emit(rect, false);
  else if (!spread && p === 1) return new Float32Array();
  else if (step < 1e-6) emit(rect, true);
  else {
    emit(clip(rect, 0, false), true);
    for (let band = 0; band < HINGES; band++) {
      emit(clip(clip(rect, band * step, true), (band + 1) * step, false), true);
    }
    emit(clip(rect, HINGES * step, true), true);
  }
  return new Float32Array(vertices);
}
