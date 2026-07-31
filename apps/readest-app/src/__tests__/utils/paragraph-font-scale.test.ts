import { afterEach, describe, expect, it } from 'vitest';

import {
  PARAGRAPH_FONT_SCALE_OPTIONS,
  PARAGRAPH_FONT_SCALE_STORAGE_KEY,
  loadParagraphFontScaleIndex,
  saveParagraphFontScaleIndex,
} from '@/utils/paragraphPresentation';

describe('paragraph mode font scale persistence (#5246)', () => {
  afterEach(() => {
    localStorage.removeItem(PARAGRAPH_FONT_SCALE_STORAGE_KEY);
  });

  it('round-trips a saved index', () => {
    saveParagraphFontScaleIndex(3);
    expect(loadParagraphFontScaleIndex()).toBe(3);
  });

  it('clamps out-of-range saves and rejects corrupt stored values', () => {
    expect(saveParagraphFontScaleIndex(-2)).toBe(0);
    expect(saveParagraphFontScaleIndex(999)).toBe(PARAGRAPH_FONT_SCALE_OPTIONS.length - 1);

    localStorage.setItem(PARAGRAPH_FONT_SCALE_STORAGE_KEY, 'garbage');
    expect(loadParagraphFontScaleIndex()).toBe(0);
    localStorage.setItem(PARAGRAPH_FONT_SCALE_STORAGE_KEY, '99');
    expect(loadParagraphFontScaleIndex()).toBe(0);
  });
});
