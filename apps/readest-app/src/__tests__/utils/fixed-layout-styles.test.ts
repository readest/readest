import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOSPlatform: vi.fn(() => 'macos' as const),
  };
});

import { applyFixedlayoutStyles, getPDFPageColors, ThemeCode } from '@/utils/style';
import { BookFormat, ViewSettings } from '@/types/book';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

function makeViewSettings(overrides: Partial<ViewSettings> = {}): ViewSettings {
  return {
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_TRANSLATOR_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
    ...overrides,
  } as ViewSettings;
}

function makeThemeCode(overrides: Partial<ThemeCode> = {}): ThemeCode {
  return {
    bg: '#ffffff',
    fg: '#000000',
    primary: '#3366cc',
    isDarkMode: false,
    palette: {
      'base-100': '#ffffff',
      'base-200': '#f0f0f0',
      'base-300': '#e0e0e0',
      'base-content': '#000000',
      neutral: '#808080',
      'neutral-content': '#ffffff',
      primary: '#3366cc',
      secondary: '#6699cc',
      accent: '#33cc99',
    },
    ...overrides,
  };
}

/** Run applyFixedlayoutStyles on a fresh document and return the injected CSS. */
function fixedLayoutCss(vs: ViewSettings, theme: ThemeCode, format: BookFormat = 'PDF'): string {
  const doc = document.implementation.createHTMLDocument('test');
  applyFixedlayoutStyles(doc, vs, theme, format);
  return doc.getElementById('fixed-layout-styles')?.textContent ?? '';
}

describe('applyFixedlayoutStyles contrast filter', () => {
  it('does not apply a contrast filter at the default 100%', () => {
    const css = fixedLayoutCss(makeViewSettings({ contrast: 100 }), makeThemeCode());
    expect(css).not.toContain('contrast(');
  });

  it('applies a contrast filter when contrast is increased above 100%', () => {
    const css = fixedLayoutCss(makeViewSettings({ contrast: 150 }), makeThemeCode());
    expect(css).toContain('filter: contrast(150%)');
  });

  it('applies a contrast filter when contrast is decreased below 100%', () => {
    const css = fixedLayoutCss(makeViewSettings({ contrast: 75 }), makeThemeCode());
    expect(css).toContain('filter: contrast(75%)');
  });

  it('applies contrast in light mode too (independent of invertImgColorInDark)', () => {
    const css = fixedLayoutCss(
      makeViewSettings({ contrast: 150, invertImgColorInDark: true }),
      makeThemeCode({ isDarkMode: false }),
    );
    expect(css).toContain('contrast(150%)');
    expect(css).not.toContain('invert(100%)');
  });

  it('combines invert and contrast into a single filter declaration in dark mode', () => {
    const css = fixedLayoutCss(
      makeViewSettings({ contrast: 150, invertImgColorInDark: true }),
      makeThemeCode({ isDarkMode: true, bg: '#1a1a1a', fg: '#e0e0e0' }),
    );
    expect(css).toContain('filter: invert(100%) hue-rotate(180deg) contrast(150%)');
  });

  it('treats an undefined contrast as 100% (no filter, backward compatible)', () => {
    const css = fixedLayoutCss(
      makeViewSettings({ contrast: undefined as unknown as number }),
      makeThemeCode(),
    );
    expect(css).not.toContain('contrast(');
  });
});

describe('applyFixedlayoutStyles page colors', () => {
  const darkTheme = makeThemeCode({ isDarkMode: true, bg: '#342e25', fg: '#ffd595' });

  it('keeps book-authored pages out of dark mode so their text stays as authored (#5649)', () => {
    const css = fixedLayoutCss(makeViewSettings(), darkTheme, 'EPUB');
    expect(css).toContain('color-scheme: light');
    expect(css).not.toContain('color-scheme: dark');
  });

  it('does not paint the theme background over book-authored pages', () => {
    const css = fixedLayoutCss(makeViewSettings(), darkTheme, 'EPUB');
    expect(css).not.toMatch(/body\s*{[^}]*background-color/);
  });

  it('still themes app-rendered pages (PDF, comics) in dark mode', () => {
    for (const format of ['PDF', 'CBZ'] as const) {
      const css = fixedLayoutCss(makeViewSettings(), darkTheme, format);
      expect(css).toContain('color-scheme: dark');
      expect(css).toMatch(/body\s*{[^}]*background-color: var\(--theme-bg-color\)/);
    }
  });
});

describe('applyFixedlayoutStyles text autosizing', () => {
  it('disables Chrome-for-Android text autosizing that misplaces per-letter positioned text (#5641)', () => {
    const css = fixedLayoutCss(makeViewSettings(), makeThemeCode(), 'EPUB');
    expect(css).toContain('-webkit-text-size-adjust: none');
    expect(css).toMatch(/[^-]text-size-adjust: none/);
  });
});

describe('applyFixedlayoutStyles unsized SVG page images', () => {
  // KCC-style comics wrap each page as `<div><svg width="100%" height="100%">
  // <image/></svg></div>` with no viewBox or image size: the percentage height
  // resolves against an auto-height div, so the svg is 150px tall and clips the
  // page image to a strip (#6530)
  it('lets an SVG without a viewBox show its unsized image beyond the svg box', () => {
    const css = fixedLayoutCss(makeViewSettings(), makeThemeCode(), 'EPUB');
    expect(css).toMatch(
      /svg:not\(\[viewBox\]\):has\(> image:not\(\[width\]\)\)\s*\{\s*overflow: visible;/,
    );
  });
});

describe('PDF dark mode (#6548)', () => {
  const darkTheme = makeThemeCode({ isDarkMode: true, bg: '#222222', fg: '#e0e0e0' });

  it('inverts pages without shifting their hues, so a blue link stays blue', () => {
    const css = fixedLayoutCss(makeViewSettings({ invertImgColorInDark: true }), darkTheme);
    expect(css).toContain('filter: invert(100%) hue-rotate(180deg);');
  });

  it('does not invert a PDF page the renderer already recolored to the theme', () => {
    const vs = makeViewSettings({ invertImgColorInDark: true, applyThemeToPDF: true });
    expect(fixedLayoutCss(vs, darkTheme, 'PDF')).not.toContain('invert(');
    // comics are not recolored by the renderer, so they still invert
    expect(fixedLayoutCss(vs, darkTheme, 'CBZ')).toContain('invert(100%)');
  });

  it('does not blend a themed PDF page into the background again', () => {
    const vs = makeViewSettings({ overrideColor: true, applyThemeToPDF: true });
    for (const theme of [darkTheme, makeThemeCode()]) {
      expect(fixedLayoutCss(vs, theme, 'PDF')).not.toContain('mix-blend-mode');
    }
    expect(fixedLayoutCss({ ...vs, applyThemeToPDF: false }, darkTheme, 'PDF')).toContain(
      'mix-blend-mode: overlay',
    );
  });

  it('gives the renderer no page colors unless asked to theme the PDF', () => {
    expect(getPDFPageColors(makeViewSettings({ applyThemeToPDF: false }), darkTheme)).toBe(
      undefined,
    );
  });

  it('keeps embedded photos in their own colors when theming the PDF', () => {
    const vs = makeViewSettings({ applyThemeToPDF: true, invertImgColorInDark: false });
    expect(getPDFPageColors(vs, darkTheme)).toEqual({
      background: '#222222',
      foreground: '#e0e0e0',
      keepImages: true,
    });
  });

  it('themes embedded images too when inverting images in dark mode', () => {
    const vs = makeViewSettings({ applyThemeToPDF: true, invertImgColorInDark: true });
    expect(getPDFPageColors(vs, darkTheme)?.keepImages).toBe(false);
    // the invert toggle has no effect in light mode
    expect(getPDFPageColors(vs, makeThemeCode())?.keepImages).toBe(true);
  });
});
