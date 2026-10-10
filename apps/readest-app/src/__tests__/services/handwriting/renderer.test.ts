import { describe, it, expect, vi } from 'vitest';
import { renderStrokes } from '@/services/handwriting/renderer';
import type { InkStroke } from '@/services/handwriting/model';

const fakeCtx = () => {
  const calls: string[] = [];
  const widths: number[] = [];
  const ctx = {
    clearRect: vi.fn(() => calls.push('clear')),
    beginPath: vi.fn(() => calls.push('begin')),
    moveTo: vi.fn(() => calls.push('move')),
    lineTo: vi.fn(() => calls.push('line')),
    stroke: vi.fn(() => calls.push('stroke')),
    arc: vi.fn(() => calls.push('arc')),
    fill: vi.fn(() => calls.push('fill')),
    set lineWidth(w: number) {
      widths.push(w);
    },
    strokeStyle: '',
    fillStyle: '',
    lineCap: '',
    lineJoin: '',
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls, widths };
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

  it('draws a dot for a single-point stroke', () => {
    const { ctx, calls } = fakeCtx();
    renderStrokes(ctx, [mk('a', [[0.5, 0.5]])], rect);
    expect(calls).toContain('arc');
  });

  it('varies line width with pressure', () => {
    const { ctx, widths } = fakeCtx();
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
    expect(new Set(widths).size).toBeGreaterThan(1);
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
