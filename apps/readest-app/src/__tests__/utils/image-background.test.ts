// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { getStyles, applyFixedlayoutStyles, type ThemeCode } from '@/utils/style';
import {
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';
import type { ViewSettings } from '@/types/book';

const DEFAULT_VIEW_SETTINGS = {
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
} as ViewSettings;

const theme = {
  bg: '#eee0c0',
  fg: '#202020',
  primary: '#3366cc',
  isDarkMode: false,
  palette: {},
} as ThemeCode;

describe('transparent image backgrounds (#7045)', () => {
  it('defaults off', () => {
    expect(DEFAULT_VIEW_SETTINGS.transparentImageBackground).toBe(false);
  });

  it.each([false, true])('applies independently of Override Book Color (%s)', (overrideColor) => {
    const css = getStyles(
      {
        ...DEFAULT_VIEW_SETTINGS,
        overrideColor,
        transparentImageBackground: true,
      },
      theme,
    );
    expect(css).toContain('readest-white-transparent');
    expect(css).toContain('mix-blend-mode: normal !important;');
    expect(css).not.toContain('filter: grayscale(');
  });

  it('removes white before applying the requested dark-mode inversion', () => {
    const css = getStyles(
      {
        ...DEFAULT_VIEW_SETTINGS,
        transparentImageBackground: true,
        invertImgColorInDark: true,
      },
      { ...theme, isDarkMode: true },
    );
    expect(css).toMatch(/filter: url\([^;]+\) invert\(100%\)/);
  });

  it('also applies to fixed-layout image pages', () => {
    const doc = document.implementation.createHTMLDocument('comic');
    applyFixedlayoutStyles(
      doc,
      {
        ...DEFAULT_VIEW_SETTINGS,
        transparentImageBackground: true,
      },
      theme,
      'CBZ',
    );
    expect(doc.getElementById('fixed-layout-styles')?.textContent).toContain(
      'readest-white-transparent',
    );
  });

  it('leaves PDF pages alone', () => {
    const doc = document.implementation.createHTMLDocument('pdf');
    applyFixedlayoutStyles(
      doc,
      {
        ...DEFAULT_VIEW_SETTINGS,
        transparentImageBackground: true,
      },
      theme,
      'PDF',
    );
    expect(doc.getElementById('fixed-layout-styles')?.textContent).not.toContain(
      'readest-white-transparent',
    );
  });
});
