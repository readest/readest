import { describe, it, expect, vi } from 'vitest';
import {
  getEffectiveLoupePoint,
  getExternalDragHandle,
  toParentViewportPoint,
} from '@/app/reader/utils/annotatorUtil';
import { Point } from '@/utils/sel';

describe('getEffectiveLoupePoint', () => {
  it('returns loupePoint when set (internal handle drag takes priority)', () => {
    const loupePoint: Point = { x: 150, y: 180 };
    const externalDragPoint: Point = { x: 280, y: 200 };
    const result = getEffectiveLoupePoint(loupePoint, externalDragPoint);
    expect(result).toBe(loupePoint);
  });

  it('returns externalDragPoint when loupePoint is null (smooth pointer tracking)', () => {
    const externalDragPoint: Point = { x: 280, y: 200 };
    const result = getEffectiveLoupePoint(null, externalDragPoint);
    expect(result).toBe(externalDragPoint);
  });

  it('returns null when both loupePoint and externalDragPoint are null', () => {
    const result = getEffectiveLoupePoint(null, null);
    expect(result).toBeNull();
  });

  it('returns null when externalDragPoint is undefined', () => {
    const result = getEffectiveLoupePoint(null, undefined);
    expect(result).toBeNull();
  });
});

describe('getExternalDragHandle', () => {
  const currentStart: Point = { x: 100, y: 200 };
  const currentEnd: Point = { x: 300, y: 200 };

  it('forward drag — externalDragPoint closer to end → returns end', () => {
    const result = getExternalDragHandle({ x: 280, y: 200 }, currentStart, currentEnd);
    expect(result).toBe('end');
  });

  it('backward drag — externalDragPoint closer to start → returns start', () => {
    const result = getExternalDragHandle({ x: 120, y: 200 }, currentStart, currentEnd);
    expect(result).toBe('start');
  });

  it('vertical text — works with vertical coordinates', () => {
    const vStart: Point = { x: 200, y: 100 };
    const vEnd: Point = { x: 200, y: 400 };
    const result = getExternalDragHandle({ x: 200, y: 350 }, vStart, vEnd);
    expect(result).toBe('end');
  });

  it('equal distance — returns end (deterministic tie-breaking)', () => {
    // Midpoint between start(100,200) and end(300,200) is (200,200)
    // distToStart === distToEnd, so !(distToStart < distToEnd) → returns 'end'
    const result = getExternalDragHandle({ x: 200, y: 200 }, currentStart, currentEnd);
    expect(result).toBe('end');
  });
});

describe('toParentViewportPoint', () => {
  it('adds frameRect offset to coordinates', () => {
    const mockFrameElement = {
      getBoundingClientRect: vi.fn(() => ({
        top: 50,
        left: 80,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      })),
    };
    const doc = {
      defaultView: {
        frameElement: mockFrameElement,
      },
    } as unknown as Document;

    const result = toParentViewportPoint(doc, 100, 200);
    expect(result).toEqual({ x: 180, y: 250 });
  });

  it('defaults to {0,0} offset when no frameElement (detached doc)', () => {
    const doc = {
      defaultView: null,
    } as unknown as Document;

    const result = toParentViewportPoint(doc, 100, 200);
    expect(result).toEqual({ x: 100, y: 200 });
  });

  it('handles non-zero iframe offset (e.g., sidebar shifts iframe right)', () => {
    const mockFrameElement = {
      getBoundingClientRect: vi.fn(() => ({
        top: 0,
        left: 250,
        right: 0,
        bottom: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: vi.fn(),
      })),
    };
    const doc = {
      defaultView: {
        frameElement: mockFrameElement,
      },
    } as unknown as Document;

    const result = toParentViewportPoint(doc, 50, 100);
    expect(result).toEqual({ x: 300, y: 100 });
  });
});
