import { describe, expect, it } from 'vitest';
import { spatialTarget } from '@/app/library/hooks/useSpatialNavigation';
const rect = (x: number, y: number, width = 100, height = 100) => ({
  left: x,
  top: y,
  width,
  height,
});
describe('mixed shelf spatial navigation', () => {
  it('moves between a carousel, a three-column grid and full-width list by geometry', () => {
    const positions = [
      rect(0, 0),
      rect(110, 0),
      rect(220, 0),
      rect(0, 160),
      rect(110, 160),
      rect(220, 160),
      rect(0, 330, 330),
      rect(0, 440, 330),
    ];
    expect(spatialTarget(positions, 1, 'ArrowDown')).toBe(4);
    expect(spatialTarget(positions, 5, 'ArrowDown')).toBe(6);
    expect(spatialTarget(positions, 6, 'ArrowDown')).toBe(7);
    expect(spatialTarget(positions, 6, 'ArrowUp')).toBe(4);
    expect(spatialTarget(positions, 4, 'ArrowLeft')).toBe(3);
  });
  it('uses physical arrows correctly in RTL', () => {
    const positions = [rect(220, 0), rect(110, 0), rect(0, 0)];
    expect(spatialTarget(positions, 0, 'ArrowLeft')).toBe(1);
    expect(spatialTarget(positions, 1, 'ArrowRight')).toBe(0);
  });
});
