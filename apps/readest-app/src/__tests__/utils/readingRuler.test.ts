import { describe, expect, it } from 'vitest';
import {
  calculateReadingRulerSize,
  clampReadingRulerPosition,
  FIXED_LAYOUT_READING_RULER_LINE_HEIGHT,
  getReadingRulerMoveDirection,
  stepReadingRulerPosition,
} from '@/app/reader/utils/readingRuler';

describe('readingRuler utils', () => {
  it('calculates fixed-layout ruler size from the configured line count', () => {
    expect(
      calculateReadingRulerSize(
        3,
        {
          defaultFontSize: 16,
          lineHeight: 1.5,
        },
        'PDF',
      ),
    ).toBe(3 * FIXED_LAYOUT_READING_RULER_LINE_HEIGHT);
  });

  it('calculates reflowable ruler size from font size and line height', () => {
    expect(
      calculateReadingRulerSize(
        2,
        {
          defaultFontSize: 18,
          lineHeight: 1.4,
        },
        'EPUB',
      ),
    ).toBe(50);
  });

  it('clamps the ruler center so the full ruler stays inside the viewport', () => {
    expect(clampReadingRulerPosition(5, 1000, 200)).toBe(10);
    expect(clampReadingRulerPosition(95, 1000, 200)).toBe(90);
    expect(clampReadingRulerPosition(33, 1000, 200)).toBe(33);
  });

  it('centers the ruler when it is larger than the viewport', () => {
    expect(clampReadingRulerPosition(10, 100, 120)).toBe(50);
    expect(clampReadingRulerPosition(90, 100, 120)).toBe(50);
  });

  it('moves by exactly one ruler window per navigation step', () => {
    expect(stepReadingRulerPosition(33, 1000, 200, 'forward')).toBe(53);
    expect(stepReadingRulerPosition(33, 1000, 200, 'backward')).toBe(13);
  });

  it('clamps stepped movement at the edges', () => {
    expect(stepReadingRulerPosition(85, 1000, 200, 'forward')).toBe(90);
    expect(stepReadingRulerPosition(15, 1000, 200, 'backward')).toBe(10);
  });

  it('maps tap and key sides to logical ruler movement direction', () => {
    expect(getReadingRulerMoveDirection('right', 'ltr')).toBe('forward');
    expect(getReadingRulerMoveDirection('left', 'ltr')).toBe('backward');
    expect(getReadingRulerMoveDirection('right', 'rtl')).toBe('backward');
    expect(getReadingRulerMoveDirection('left', 'rtl')).toBe('forward');
    expect(getReadingRulerMoveDirection('down', 'rtl')).toBe('forward');
    expect(getReadingRulerMoveDirection('up', 'ltr')).toBe('backward');
  });
});
