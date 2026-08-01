import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOSPlatform: vi.fn(() => 'macos' as const),
  };
});

import { applyRenditionLayoutClass, getStyles, type ThemeCode } from '@/utils/style';
import type { ViewSettings } from '@/types/book';
import {
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_VIEW_CONFIG,
} from '@/services/constants';

const makeViewSettings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
  ({
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
  }) as ViewSettings;

const theme: ThemeCode = {
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
};

const mountBookContent = (overrideFont: boolean, isFixedLayout = false, minimumFontSize = 8) => {
  document.body.innerHTML = `
    <style id="publisher-styles">
      p.indent { font-size: 0.875rem; }
      h1 { font-size: 1.5rem; }
    </style>
    <style id="reader-styles">${getStyles(
      makeViewSettings({ overrideFont, defaultFontSize: 20, minimumFontSize }),
      theme,
    )}</style>
    <h1 id="heading">Heading</h1>
    <p class="indent" id="paragraph"><small id="small">Lead-in</small> body copy</p>
  `;
  applyRenditionLayoutClass(document, isFixedLayout);
};

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  document.documentElement.removeAttribute('dir');
  document.documentElement.style.removeProperty('writing-mode');
});

describe('reflowable book font-size override', () => {
  it('normalizes publisher-sized body copy to the configured root size', () => {
    mountBookContent(true);

    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const paragraphSize = parseFloat(
      getComputedStyle(document.querySelector('#paragraph')!).fontSize,
    );
    const headingSize = parseFloat(getComputedStyle(document.querySelector('#heading')!).fontSize);
    const smallSize = parseFloat(getComputedStyle(document.querySelector('#small')!).fontSize);

    expect(rootSize).toBe(20);
    expect(paragraphSize).toBe(rootSize);
    expect(headingSize).toBe(30);
    expect(smallSize).toBeLessThan(paragraphSize);
  });

  it('normalizes body-copy sizing independently from the font-family override', () => {
    mountBookContent(false);

    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    expect(parseFloat(getComputedStyle(document.querySelector('#paragraph')!).fontSize)).toBe(
      rootSize,
    );
  });

  it('does not normalize fixed-layout content', () => {
    mountBookContent(true, true);

    expect(document.body.classList.contains('readest-fixed-layout')).toBe(true);
    expect(parseFloat(getComputedStyle(document.querySelector('#paragraph')!).fontSize)).toBe(17.5);
  });

  it('continues to honor the configured minimum font size', () => {
    mountBookContent(true, false, 24);

    expect(parseFloat(getComputedStyle(document.querySelector('#paragraph')!).fontSize)).toBe(24);
  });

  it('is independent of document direction and writing mode', () => {
    mountBookContent(true);
    document.documentElement.dir = 'rtl';
    document.documentElement.style.writingMode = 'vertical-rl';

    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    expect(parseFloat(getComputedStyle(document.querySelector('#paragraph')!).fontSize)).toBe(
      rootSize,
    );
  });
});
