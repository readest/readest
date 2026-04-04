import { describe, it, expect, vi } from 'vitest';
import {
  getExternalDragHandle,
  getHighlightColorLabel,
  normalizeHighlightColorKey,
  toParentViewportPoint,
} from '@/app/reader/utils/annotatorUtil';
import { Point } from '@/utils/sel';
import { SystemSettings } from '@/types/settings';

describe('getExternalDragHandle', () => {
  const currentStart: Point = { x: 100, y: 200 };
  const currentEnd: Point = { x: 300, y: 200 };

  it('forward drag — externalDragPoint closer to end → returns end', () => {
    const result = getExternalDragHandle(currentStart, currentEnd, { x: 280, y: 200 });
    expect(result).toBe('end');
  });

  it('backward drag — externalDragPoint closer to start → returns start', () => {
    const result = getExternalDragHandle(currentStart, currentEnd, { x: 120, y: 200 });
    expect(result).toBe('start');
  });

  it('returns null when externalDragPoint is null', () => {
    const result = getExternalDragHandle(currentStart, currentEnd, null);
    expect(result).toBeNull();
  });

  it('returns null when externalDragPoint is undefined', () => {
    const result = getExternalDragHandle(currentStart, currentEnd);
    expect(result).toBeNull();
  });

  it('vertical text — works with vertical coordinates', () => {
    const vStart: Point = { x: 200, y: 100 };
    const vEnd: Point = { x: 200, y: 400 };
    const result = getExternalDragHandle(vStart, vEnd, { x: 200, y: 350 });
    expect(result).toBe('end');
  });

  it('equal distance — returns end (deterministic tie-breaking)', () => {
    // Midpoint between start(100,200) and end(300,200) is (200,200)
    // distToStart === distToEnd, so !(distToStart < distToEnd) → returns 'end'
    const result = getExternalDragHandle(currentStart, currentEnd, { x: 200, y: 200 });
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

describe('highlight color label helpers', () => {
  const makeSettings = (labels: Record<string, string>): SystemSettings =>
    ({
      globalReadSettings: {
        highlightColorLabels: labels,
      },
    }) as SystemSettings;

  it('normalizes hex color keys to lowercase', () => {
    expect(normalizeHighlightColorKey('#AABBCC')).toBe('#aabbcc');
    expect(normalizeHighlightColorKey('#aabbcc')).toBe('#aabbcc');
    expect(normalizeHighlightColorKey('yellow')).toBe('yellow');
  });

  it('returns custom label for built-in color key', () => {
    const settings = makeSettings({ yellow: 'Foreshadowing' });
    expect(getHighlightColorLabel(settings, 'yellow')).toBe('Foreshadowing');
  });

  it('returns custom label for hex key regardless of case', () => {
    const settings = makeSettings({ '#aabbcc': 'Romance' });
    expect(getHighlightColorLabel(settings, '#AABBCC')).toBe('Romance');
  });

  it('falls back to the color value when label is missing', () => {
    const settings = makeSettings({});
    expect(getHighlightColorLabel(settings, 'green')).toBe('green');
    expect(getHighlightColorLabel(settings, '#123456')).toBe('#123456');
  });
});
