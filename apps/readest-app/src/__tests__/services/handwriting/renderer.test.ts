import { describe, it, expect, vi } from 'vitest';
import { renderStrokes } from '@/services/handwriting/renderer';
import type { InkStroke } from '@/services/handwriting/model';

const fakeCtx = () => {
  const calls: string[] = [];
  const widths: number[] = [];
  const radii: number[] = [];
  const alphas: number[] = [];
  const ctx = {
    clearRect: vi.fn(() => calls.push('clear')),
    beginPath: vi.fn(() => calls.push('begin')),
    moveTo: vi.fn(() => calls.push('move')),
    lineTo: vi.fn(() => calls.push('line')),
    quadraticCurveTo: vi.fn(() => calls.push('curve')),
    stroke: vi.fn(() => {
      calls.push('stroke');
      alphas.push(ctx.globalAlpha);
    }),
    save: vi.fn(),
    restore: vi.fn(() => {
      ctx.globalAlpha = 1;
    }),
    globalAlpha: 1,
    arc: vi.fn((_x: number, _y: number, r: number) => {
      calls.push('arc');
      radii.push(r);
    }),
    closePath: vi.fn(() => calls.push('close')),
    fill: vi.fn(() => calls.push('fill')),
    set lineWidth(w: number) {
      widths.push(w);
    },
    strokeStyle: '',
    fillStyle: '',
    lineCap: '',
    lineJoin: '',
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    calls,
    widths,
    radii,
    alphas,
    raw: ctx,
  };
};

const rect = { left: 0, top: 0, width: 1000, height: 2000 };
const mk = (id: string, points: InkStroke['points'], color = '#000'): InkStroke => ({
  id,
  color,
  width: 0.01,
  points,
});

describe('renderStrokes', () => {
  it('clears the canvas and draws each stroke', () => {
    const { ctx, calls } = fakeCtx();
    renderStrokes(
      ctx,
      [
        mk('a', [
          [0, 0],
          [1, 1],
        ]),
        mk('b', [
          [0, 1],
          [1, 0],
        ]),
      ],
      rect,
    );
    expect(calls[0]).toBe('clear');
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(2);
  });

  it('scales normalized points to the page rect', () => {
    const { ctx } = fakeCtx();
    renderStrokes(
      ctx,
      [
        mk('a', [
          [0.5, 0.5],
          [1, 1],
        ]),
      ],
      rect,
    );
    expect(ctx.moveTo).toHaveBeenCalledWith(500, 1000);
    expect(ctx.lineTo).toHaveBeenCalledWith(1000, 2000);
  });

  it('draws a smooth curve through the samples, not a polyline', () => {
    const { ctx, calls } = fakeCtx();
    const arc: InkStroke['points'] = [
      [0.1, 0.5],
      [0.2, 0.4],
      [0.3, 0.38],
      [0.4, 0.4],
      [0.5, 0.5],
    ];
    renderStrokes(ctx, [mk('a', arc)], rect);
    expect(calls.filter((c) => c === 'curve').length).toBeGreaterThanOrEqual(3);
    // It still starts and ends on the stroke's own endpoints.
    expect(ctx.moveTo).toHaveBeenCalledWith(100, 1000);
    expect(ctx.lineTo).toHaveBeenLastCalledWith(500, 1000);
  });

  it('fills a pressure stroke as one shape, so its edge is antialiased once', () => {
    const { ctx, calls } = fakeCtx();
    const arc: InkStroke['points'] = [
      [0.1, 0.5, 0.3],
      [0.2, 0.4, 0.5],
      [0.3, 0.38, 0.7],
      [0.4, 0.4, 0.5],
      [0.5, 0.5, 0.3],
    ];
    renderStrokes(ctx, [mk('a', arc)], rect);
    expect(calls.filter((c) => c === 'fill')).toHaveLength(1);
    expect(calls).not.toContain('stroke');
  });

  it('draws a dot for a single-point stroke', () => {
    const { ctx, calls } = fakeCtx();
    renderStrokes(ctx, [mk('a', [[0.5, 0.5]])], rect);
    expect(calls).toContain('arc');
  });

  it('varies line width with pressure', () => {
    const { ctx, radii } = fakeCtx();
    renderStrokes(
      ctx,
      [
        mk('a', [
          [0, 0, 0.2],
          [0.5, 0.5, 1],
          [1, 1, 1],
        ]),
      ],
      rect,
    );
    expect(Math.min(...radii)).toBeCloseTo(3.5);
    expect(Math.max(...radii)).toBeCloseTo(7.5);
  });

  it('draws a stroke at its pen width under ordinary pressure', () => {
    const { ctx, radii } = fakeCtx();
    renderStrokes(
      ctx,
      [
        mk('a', [
          [0, 0, 0.5],
          [1, 1, 0.5],
        ]),
      ],
      rect,
    );
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.every((r) => r === 5)).toBe(true);
  });

  it('keeps a feather-light stroke at half its pen width', () => {
    const { ctx, radii } = fakeCtx();
    renderStrokes(
      ctx,
      [
        mk('a', [
          [0, 0, 0],
          [1, 1, 0],
        ]),
      ],
      rect,
    );
    expect(radii.length).toBeGreaterThan(0);
    expect(radii.every((r) => r === 2.5)).toBe(true);
  });

  it('draws a marker stroke translucent at its full width in one pass, ignoring pressure', () => {
    const { ctx, calls, widths, alphas, raw } = fakeCtx();
    const marker: InkStroke = {
      ...mk('m', [
        [0.1, 0.5, 0.2],
        [0.3, 0.5, 1],
        [0.5, 0.5, 0.4],
      ]),
      tool: 'marker',
    };
    renderStrokes(ctx, [marker], rect);
    // One stroked path: a marker does not darken where it crosses itself.
    expect(calls.filter((c) => c === 'stroke')).toHaveLength(1);
    expect(calls).not.toContain('fill');
    expect(widths).toEqual([10]);
    expect(alphas[0]).toBeGreaterThan(0.2);
    expect(alphas[0]).toBeLessThan(0.7);
    // The next stroke is opaque again.
    expect(raw.globalAlpha).toBe(1);
  });

  it('uses each stroke color', () => {
    const { ctx } = fakeCtx();
    renderStrokes(
      ctx,
      [
        mk(
          'a',
          [
            [0, 0],
            [1, 1],
          ],
          '#ff0000',
        ),
      ],
      rect,
    );
    expect(ctx.strokeStyle).toBe('#ff0000');
  });
});
