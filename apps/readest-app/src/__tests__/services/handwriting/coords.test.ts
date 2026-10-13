import { describe, it, expect } from 'vitest';
import { screenToPage, type PageRect } from '@/services/handwriting/coords';

const rect: PageRect = { left: 100, top: 50, width: 400, height: 800 };

describe('handwriting coordinates', () => {
  it('maps screen to normalized page coordinates', () => {
    expect(screenToPage({ x: 300, y: 450 }, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(screenToPage({ x: 100, y: 50 }, rect)).toEqual({ x: 0, y: 0 });
  });

  it('normalizes against the page wherever it sits on screen', () => {
    // Zoom, pan and resize only move the rect; the same spot on the page
    // always maps to the same normalized point.
    const zoomed: PageRect = { left: -200, top: -100, width: 800, height: 1600 };
    expect(screenToPage({ x: 200, y: 700 }, zoomed)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('reports points outside the page bounds as out of range', () => {
    expect(screenToPage({ x: 50, y: 50 }, rect).x).toBeLessThan(0);
    expect(screenToPage({ x: 50, y: 50 }, rect, { clamp: true }).x).toBe(0);
  });

  it('guards against zero-sized rects', () => {
    expect(screenToPage({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});
