import { describe, it, expect } from 'vitest';

import { simplifyPoints, type InkPoint } from '@/services/handwriting/model';

describe('simplifyPoints', () => {
  it('drops points that sit on the line between their neighbours', () => {
    const straight: InkPoint[] = [];
    for (let i = 0; i <= 100; i++) straight.push([i / 100, 0.5]);
    // A perfectly straight line needs only its endpoints.
    expect(simplifyPoints(straight)).toEqual([
      [0, 0.5],
      [1, 0.5],
    ]);
  });

  it('keeps corners, which carry the shape of the stroke', () => {
    const corner: InkPoint[] = [
      [0, 0],
      [0.5, 0],
      [0.5, 0.5],
      [1, 0.5],
    ];
    expect(simplifyPoints(corner)).toHaveLength(4);
  });

  it('drops the middle of a straight run between two corners', () => {
    const withMidpoint: InkPoint[] = [
      [0, 0],
      [0.25, 0],
      [0.5, 0],
      [0.5, 0.5],
    ];
    expect(simplifyPoints(withMidpoint)).toHaveLength(3);
  });

  it('never drops a stroke of one or two points', () => {
    const dot: InkPoint[] = [[0.5, 0.5]];
    const pair: InkPoint[] = [
      [0.1, 0.1],
      [0.2, 0.2],
    ];
    expect(simplifyPoints(dot)).toBe(dot);
    expect(simplifyPoints(pair)).toBe(pair);
  });

  it('keeps pressure on retained samples', () => {
    const points: InkPoint[] = [
      [0, 0.5, 0.1],
      [0.5, 0.5, 0.9],
      [1, 0.5, 0.4],
    ];
    expect(simplifyPoints(points)).toEqual([
      [0, 0.5, 0.1],
      [1, 0.5, 0.4],
    ]);
  });

  it('handles a long stroke without overflowing the stack', () => {
    // Recursive RDP would nest deeply on this; the iterative version must not.
    const many: InkPoint[] = [];
    for (let i = 0; i < 20000; i++) many.push([i / 20000, i % 2 === 0 ? 0.5 : 0.5001]);
    expect(() => simplifyPoints(many)).not.toThrow();
  });

  it('shrinks a realistically noisy stroke', () => {
    const noisy: InkPoint[] = [];
    for (let i = 0; i < 2000; i++) noisy.push([i / 2000, 0.5 + Math.sin(i) * 0.0004]);
    const kept = simplifyPoints(noisy).length;
    expect(kept).toBeLessThan(noisy.length);
    expect(kept).toBeGreaterThanOrEqual(2);
  });
});
