import { describe, it, expect } from 'vitest';

import { getOverlayerBlendMode } from '@/utils/style';

describe('getOverlayerBlendMode', () => {
  it('multiplies onto a light page so the band darkens the paper', () => {
    expect(getOverlayerBlendMode({ isDarkMode: false, isBwEink: false })).toBe('multiply');
  });

  it('screens onto a dark reflowable page so the band lightens the ink', () => {
    expect(getOverlayerBlendMode({ isDarkMode: true, isBwEink: false })).toBe('screen');
  });

  it('masks with difference on B&W e-ink in either theme', () => {
    expect(getOverlayerBlendMode({ isDarkMode: false, isBwEink: true })).toBe('difference');
    expect(getOverlayerBlendMode({ isDarkMode: true, isBwEink: true })).toBe('difference');
  });

  // #5790 / #5930 / #5943: a PDF keeps the book's own white bitmap in dark mode
  // unless the reader asked us to darken it, and `screen` over white paints no
  // band at all — it only tints the glyphs.
  it('multiplies over a PDF that stays light in dark mode', () => {
    expect(
      getOverlayerBlendMode({
        isDarkMode: true,
        isBwEink: false,
        isFixedLayout: true,
        format: 'PDF',
      }),
    ).toBe('multiply');
  });

  it('screens over a PDF the reader inverted into dark mode', () => {
    expect(
      getOverlayerBlendMode({
        isDarkMode: true,
        isBwEink: false,
        isFixedLayout: true,
        format: 'PDF',
        invertImgColorInDark: true,
      }),
    ).toBe('screen');
  });

  it('screens over a PDF rendered with the theme page colors', () => {
    expect(
      getOverlayerBlendMode({
        isDarkMode: true,
        isBwEink: false,
        isFixedLayout: true,
        format: 'PDF',
        applyThemeToPDF: true,
      }),
    ).toBe('screen');
  });

  it('ignores applyThemeToPDF for comic pages, which are never re-rendered', () => {
    expect(
      getOverlayerBlendMode({
        isDarkMode: true,
        isBwEink: false,
        isFixedLayout: true,
        format: 'CBZ',
        applyThemeToPDF: true,
      }),
    ).toBe('multiply');
  });

  it('still multiplies on a light-theme PDF whatever the darkening settings say', () => {
    expect(
      getOverlayerBlendMode({
        isDarkMode: false,
        isBwEink: false,
        isFixedLayout: true,
        format: 'PDF',
        invertImgColorInDark: true,
        applyThemeToPDF: true,
      }),
    ).toBe('multiply');
  });
});
