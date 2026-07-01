import { describe, it, expect, vi } from 'vitest';

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOSPlatform: vi.fn(() => 'macos' as const),
  };
});

import { applyFixedlayoutStyles, ThemeCode } from '@/utils/style';
import { ViewSettings } from '@/types/book';
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
function fixedLayoutCss(vs: ViewSettings, theme: ThemeCode): string {
  const doc = document.implementation.createHTMLDocument('test');
  applyFixedlayoutStyles(doc, vs, theme);
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
    expect(css).toContain('filter: invert(100%) contrast(150%)');
  });

  it('treats an undefined contrast as 100% (no filter, backward compatible)', () => {
    const css = fixedLayoutCss(
      makeViewSettings({ contrast: undefined as unknown as number }),
      makeThemeCode(),
    );
    expect(css).not.toContain('contrast(');
  });
});
