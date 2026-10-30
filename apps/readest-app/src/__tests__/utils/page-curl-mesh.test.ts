import { describe, expect, it } from 'vitest';
import { buildPageCurlMesh } from '@/utils/pageCurlMesh';

describe('paper curl mesh', () => {
  it('bends the upper corner at the reference fold instead of delaying it on tall screens', () => {
    const mesh = buildPageCurlMesh(400, 800, 0.25, 0.5, false, 1);
    const liftedTop: number[] = [];
    for (let i = 0; i < mesh.length; i += 6) {
      if (mesh[i + 1] === 0 && mesh[i + 4]! > 0.001) liftedTop.push(mesh[i]! * 400);
    }
    // Reference fold centre: 400 - (400 + 0.7 * 400) * 0.25 = 230.
    // Its slope is 0.15, so it meets the upper edge at x=290. Allow one
    // hinge strip before lift becomes positive; an extra half-height bias
    // postpones this intersection to x=350 and visibly shrinks the corner.
    expect(Math.min(...liftedTop)).toBeLessThan(300);
  });

  it('preserves every source pixel without gaps or overlapping strips', () => {
    for (const [w, h] of [
      [400, 300],
      [390, 844],
      [1200, 800],
    ]) {
      for (const columns of [1, 2]) {
        for (const rtl of [false, true]) {
          for (const p of [0, 0.001, 0.25, 0.5, 0.8, 0.999]) {
            for (const y of [0.05, 0.5, 0.95]) {
              const mesh = buildPageCurlMesh(w!, h!, p, y, rtl, columns);
              expect([...mesh].every(Number.isFinite)).toBe(true);
              let area = 0;
              for (let i = 0; i < mesh.length; i += 18) {
                const ax = mesh[i]!;
                const ay = mesh[i + 1]!;
                const bx = mesh[i + 6]!;
                const by = mesh[i + 7]!;
                const cx = mesh[i + 12]!;
                const cy = mesh[i + 13]!;
                area += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
              }
              expect(area).toBeCloseTo(1, 5);
            }
          }
        }
      }
    }
  });

  it('returns a flat, unshaded page when a turn is cancelled', () => {
    for (const rtl of [false, true]) {
      const mesh = buildPageCurlMesh(400, 300, 0, 0.95, rtl, 1);
      for (let i = 0; i < mesh.length; i += 6) {
        expect(mesh[i + 2]).toBeCloseTo(mesh[i]! * 400);
        expect(mesh[i + 3]).toBeCloseTo(mesh[i + 1]! * 300);
        expect(mesh[i + 4]).toBe(0);
        expect(mesh[i + 5]).toBe(0);
      }
    }
  });

  it('uses the same geometry mirrored for a backward / RTL turn', () => {
    const left = buildPageCurlMesh(400, 300, 0.45, 0.65, false, 1);
    const right = buildPageCurlMesh(400, 300, 0.45, 0.65, true, 1);
    expect(right.length).toBe(left.length);
    for (let i = 0; i < left.length; i += 6) {
      expect(right[i]).toBeCloseTo(1 - left[i]!);
      expect(right[i + 2]).toBeCloseTo(400 - left[i + 2]!, 3);
      expect(right[i + 3]).toBe(left[i + 3]);
      expect(right[i + 4]).toBe(left[i + 4]);
    }
  });
});
