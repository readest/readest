import { describe, it, expect } from 'vitest';
import { screenToPage, pageToScreen, type PageRect } from '@/services/handwriting/coords';

const rect: PageRect = { left: 100, top: 50, width: 400, height: 800 };

describe('handwriting coordinates', () => {
  it('maps screen to normalized page coordinates', () => {
    expect(screenToPage({ x: 300, y: 450 }, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(screenToPage({ x: 100, y: 50 }, rect)).toEqual({ x: 0, y: 0 });
  });

  it('round-trips page to screen', () => {
    const p = screenToPage({ x: 217, y: 613 }, rect);
    const s = pageToScreen(p, rect);
    expect(s.x).toBeCloseTo(217);
    expect(s.y).toBeCloseTo(613);
  });

  it('keeps the logical position when the page is zoomed', () => {
    const p = screenToPage({ x: 300, y: 450 }, rect);
    const zoomed: PageRect = { left: 0, top: 0, width: 800, height: 1600 };
    expect(pageToScreen(p, zoomed)).toEqual({ x: 400, y: 800 });
  });

  it('keeps the logical position after a resize/rotation', () => {
    const p = screenToPage({ x: 300, y: 450 }, rect);
    const rotated: PageRect = { left: 10, top: 20, width: 800, height: 400 };
    expect(pageToScreen(p, rotated)).toEqual({ x: 410, y: 220 });
  });

  it('reports points outside the page bounds as out of range', () => {
    expect(screenToPage({ x: 50, y: 50 }, rect).x).toBeLessThan(0);
    expect(screenToPage({ x: 50, y: 50 }, rect, { clamp: true }).x).toBe(0);
  });

  it('follows scrolling because the rect moves with the page', () => {
    const p = screenToPage({ x: 300, y: 450 }, rect);
    const scrolled: PageRect = { ...rect, top: rect.top - 200 };
    expect(pageToScreen(p, scrolled).y).toBe(250);
  });

  it('guards against zero-sized rects', () => {
    expect(screenToPage({ x: 1, y: 1 }, { left: 0, top: 0, width: 0, height: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});
