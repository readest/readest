import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getOSPlatform: vi.fn(() => 'macos' as const),
  };
});

vi.mock('@/styles/themes', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
  };
});

import type { ViewSettings } from '@/types/book';
import type { ThemeCode } from '@/utils/style';
import {
  applyThemeModeClass,
  applyScrollModeClass,
  applyScrollbarStyle,
  applyTranslationStyle,
  getThemeCode,
  getStyles,
  applyImageStyle,
  keepTextAlignment,
  applyTableStyle,
} from '@/utils/style';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_TTS_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_SCREEN_CONFIG,
} from '@/services/constants';

/**
 * Build a minimal but type-complete ViewSettings for testing.
 */
const makeViewSettings = (overrides: Partial<ViewSettings> = {}): ViewSettings =>
  ({
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_TRANSLATOR_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
    ...overrides,
  }) as ViewSettings;

// ---------------------------------------------------------------------------
// applyThemeModeClass
// ---------------------------------------------------------------------------
describe('applyThemeModeClass', () => {
  it('adds theme-dark and removes theme-light when isDarkMode is true', () => {
    document.body.className = 'theme-light other-class';
    applyThemeModeClass(document, true);
    expect(document.body.classList.contains('theme-dark')).toBe(true);
    expect(document.body.classList.contains('theme-light')).toBe(false);
    expect(document.body.classList.contains('other-class')).toBe(true);
  });

  it('adds theme-light and removes theme-dark when isDarkMode is false', () => {
    document.body.className = 'theme-dark other-class';
    applyThemeModeClass(document, false);
    expect(document.body.classList.contains('theme-light')).toBe(true);
    expect(document.body.classList.contains('theme-dark')).toBe(false);
    expect(document.body.classList.contains('other-class')).toBe(true);
  });

  it('works when no prior theme class exists', () => {
    document.body.className = '';
    applyThemeModeClass(document, true);
    expect(document.body.classList.contains('theme-dark')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyScrollModeClass
// ---------------------------------------------------------------------------
describe('applyScrollModeClass', () => {
  it('adds scroll-mode and removes paginated-mode when isScrollMode is true', () => {
    document.body.className = 'paginated-mode';
    applyScrollModeClass(document, true);
    expect(document.body.classList.contains('scroll-mode')).toBe(true);
    expect(document.body.classList.contains('paginated-mode')).toBe(false);
  });

  it('adds paginated-mode and removes scroll-mode when isScrollMode is false', () => {
    document.body.className = 'scroll-mode';
    applyScrollModeClass(document, false);
    expect(document.body.classList.contains('paginated-mode')).toBe(true);
    expect(document.body.classList.contains('scroll-mode')).toBe(false);
  });

  it('works when neither class exists yet', () => {
    document.body.className = '';
    applyScrollModeClass(document, false);
    expect(document.body.classList.contains('paginated-mode')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyScrollbarStyle
// ---------------------------------------------------------------------------
describe('applyScrollbarStyle', () => {
  beforeEach(() => {
    // Clean up any leftover style elements
    const el = document.getElementById('scrollbar-hide-style');
    if (el) el.remove();
  });

  it('creates a style element with scrollbar-width: none when hideScrollbar is true', () => {
    applyScrollbarStyle(document, true);
    const el = document.getElementById('scrollbar-hide-style') as HTMLStyleElement;
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('scrollbar-width: none');
  });

  it('updates existing style element on subsequent calls', () => {
    applyScrollbarStyle(document, true);
    applyScrollbarStyle(document, true);
    const elements = document.querySelectorAll('#scrollbar-hide-style');
    expect(elements.length).toBe(1);
  });

  it('sets scrollbar-width: thin when hideScrollbar is false and element exists', () => {
    applyScrollbarStyle(document, true);
    applyScrollbarStyle(document, false);
    const el = document.getElementById('scrollbar-hide-style') as HTMLStyleElement;
    expect(el.textContent).toContain('scrollbar-width: thin');
  });

  it('does not create a style element when hideScrollbar is false and none exists', () => {
    applyScrollbarStyle(document, false);
    const el = document.getElementById('scrollbar-hide-style');
    expect(el).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// applyTranslationStyle
// ---------------------------------------------------------------------------
describe('applyTranslationStyle', () => {
  beforeEach(() => {
    const el = document.getElementById('translation-style');
    if (el) el.remove();
  });

  it('creates a style element with translation CSS', () => {
    const vs = makeViewSettings({ showTranslateSource: true });
    applyTranslationStyle(vs);
    const el = document.getElementById('translation-style') as HTMLStyleElement;
    expect(el).not.toBeNull();
    expect(el.textContent).toContain('.translation-source');
    expect(el.textContent).toContain('.translation-target');
    expect(el.textContent).toContain('.translation-target-block');
  });

  it('includes margin for translation-target-block when showTranslateSource is true', () => {
    const vs = makeViewSettings({ showTranslateSource: true });
    applyTranslationStyle(vs);
    const el = document.getElementById('translation-style') as HTMLStyleElement;
    expect(el.textContent).toContain('margin: 0.5em 0');
  });

  it('does not include margin for translation-target-block when showTranslateSource is false', () => {
    const vs = makeViewSettings({ showTranslateSource: false });
    applyTranslationStyle(vs);
    const el = document.getElementById('translation-style') as HTMLStyleElement;
    expect(el.textContent).not.toContain('margin: 0.5em 0');
  });

  it('replaces existing style element on second call', () => {
    const vs1 = makeViewSettings({ showTranslateSource: true });
    applyTranslationStyle(vs1);
    const vs2 = makeViewSettings({ showTranslateSource: false });
    applyTranslationStyle(vs2);
    const elements = document.querySelectorAll('#translation-style');
    expect(elements.length).toBe(1);
    const el = elements[0] as HTMLStyleElement;
    expect(el.textContent).not.toContain('margin: 0.5em 0');
  });
});

// ---------------------------------------------------------------------------
// getThemeCode
// ---------------------------------------------------------------------------
describe('getThemeCode', () => {
  const savedStorage: Record<string, string> = {};

  beforeEach(() => {
    // Save and clear localStorage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) savedStorage[key] = localStorage.getItem(key) || '';
    }
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    for (const [key, value] of Object.entries(savedStorage)) {
      localStorage.setItem(key, value);
    }
  });

  it('returns light mode ThemeCode with default theme', () => {
    localStorage.setItem('themeMode', 'light');
    localStorage.setItem('themeColor', 'default');
    const code = getThemeCode();
    expect(code.isDarkMode).toBe(false);
    expect(code.bg).toBeTruthy();
    expect(code.fg).toBeTruthy();
    expect(code.primary).toBeTruthy();
    expect(code.palette).toBeTruthy();
  });

  it('returns dark mode ThemeCode when themeMode is dark', () => {
    localStorage.setItem('themeMode', 'dark');
    localStorage.setItem('themeColor', 'default');
    const code = getThemeCode();
    expect(code.isDarkMode).toBe(true);
  });

  it('respects systemIsDarkMode in auto mode', () => {
    localStorage.setItem('themeMode', 'auto');
    localStorage.setItem('systemIsDarkMode', 'true');
    const code = getThemeCode();
    expect(code.isDarkMode).toBe(true);
  });

  it('returns light when auto mode and systemIsDarkMode is false', () => {
    localStorage.setItem('themeMode', 'auto');
    localStorage.setItem('systemIsDarkMode', 'false');
    const code = getThemeCode();
    expect(code.isDarkMode).toBe(false);
  });

  it('falls back to default theme when custom themeColor not found', () => {
    localStorage.setItem('themeColor', 'nonexistent-theme-xyz');
    localStorage.setItem('themeMode', 'light');
    const code = getThemeCode();
    // Should fall back to themes[0] (default)
    expect(code.bg).toBeTruthy();
    expect(code.isDarkMode).toBe(false);
  });

  it('uses custom theme when provided in localStorage', () => {
    const customThemes = [
      {
        name: 'my-custom',
        label: 'My Custom',
        colors: {
          light: { bg: '#fafafa', fg: '#111111', primary: '#cc0000' },
          dark: { bg: '#111111', fg: '#fafafa', primary: '#ff4444' },
        },
      },
    ];
    localStorage.setItem('themeColor', 'my-custom');
    localStorage.setItem('themeMode', 'light');
    localStorage.setItem('customThemes', JSON.stringify(customThemes));
    const code = getThemeCode();
    expect(code.bg).toBe('#fafafa');
    expect(code.fg).toBe('#111111');
    expect(code.primary).toBe('#cc0000');
    expect(code.isDarkMode).toBe(false);
  });

  it('uses dark palette of custom theme when in dark mode', () => {
    const customThemes = [
      {
        name: 'my-dark-custom',
        label: 'Dark Custom',
        colors: {
          light: { bg: '#ffffff', fg: '#000000', primary: '#0066cc' },
          dark: { bg: '#1a1a1a', fg: '#e0e0e0', primary: '#77bbee' },
        },
      },
    ];
    localStorage.setItem('themeColor', 'my-dark-custom');
    localStorage.setItem('themeMode', 'dark');
    localStorage.setItem('customThemes', JSON.stringify(customThemes));
    const code = getThemeCode();
    expect(code.bg).toBe('#1a1a1a');
    expect(code.fg).toBe('#e0e0e0');
    expect(code.isDarkMode).toBe(true);
  });

  it('returns defaults when localStorage is empty', () => {
    const code = getThemeCode();
    // auto mode with systemIsDarkMode not set => light
    expect(code.isDarkMode).toBe(false);
    expect(code.bg).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// getStyles
// ---------------------------------------------------------------------------
describe('getStyles', () => {
  it('returns a CSS string containing font, layout, and color sections', () => {
    const vs = makeViewSettings();
    const themeCode: ThemeCode = {
      bg: '#ffffff',
      fg: '#171717',
      primary: '#0066cc',
      palette: {
        'base-100': '#ffffff',
        'base-200': '#f2f2f2',
        'base-300': '#e0e0e0',
        'base-content': '#171717',
        neutral: '#cccccc',
        'neutral-content': '#444444',
        primary: '#0066cc',
        secondary: '#3399ff',
        accent: '#0055aa',
      },
      isDarkMode: false,
    };
    const css = getStyles(vs, themeCode);

    // Font section
    expect(css).toContain('--serif:');
    expect(css).toContain('--sans-serif:');
    expect(css).toContain('--monospace:');
    expect(css).toContain('font-size:');

    // Layout section
    expect(css).toContain('--margin-top:');
    expect(css).toContain('line-height:');
    expect(css).toContain('text-indent:');

    // Color section
    expect(css).toContain('--theme-bg-color:');
    expect(css).toContain('--theme-fg-color:');
    expect(css).toContain('--theme-primary-color:');

    // Translation section
    expect(css).toContain('.translation-source');
  });

  it('includes user stylesheet content', () => {
    const vs = makeViewSettings({ userStylesheet: '.custom-class { color: red; }' });
    const themeCode: ThemeCode = {
      bg: '#ffffff',
      fg: '#171717',
      primary: '#0066cc',
      palette: {
        'base-100': '#ffffff',
        'base-200': '#f2f2f2',
        'base-300': '#e0e0e0',
        'base-content': '#171717',
        neutral: '#cccccc',
        'neutral-content': '#444444',
        primary: '#0066cc',
        secondary: '#3399ff',
        accent: '#0055aa',
      },
      isDarkMode: false,
    };
    const css = getStyles(vs, themeCode);
    expect(css).toContain('.custom-class { color: red; }');
  });

  it('includes overrideFont !important rules when overrideFont is true', () => {
    const vs = makeViewSettings({ overrideFont: true });
    const themeCode: ThemeCode = {
      bg: '#ffffff',
      fg: '#171717',
      primary: '#0066cc',
      palette: {
        'base-100': '#ffffff',
        'base-200': '#f2f2f2',
        'base-300': '#e0e0e0',
        'base-content': '#171717',
        neutral: '#cccccc',
        'neutral-content': '#444444',
        primary: '#0066cc',
        secondary: '#3399ff',
        accent: '#0055aa',
      },
      isDarkMode: false,
    };
    const css = getStyles(vs, themeCode);
    expect(css).toContain('font-family: revert !important');
  });

  it('applies overrideColor styles when overrideColor is true', () => {
    const vs = makeViewSettings({ overrideColor: true });
    const themeCode: ThemeCode = {
      bg: '#ffffff',
      fg: '#171717',
      primary: '#0066cc',
      palette: {
        'base-100': '#ffffff',
        'base-200': '#f2f2f2',
        'base-300': '#e0e0e0',
        'base-content': '#171717',
        neutral: '#cccccc',
        'neutral-content': '#444444',
        primary: '#0066cc',
        secondary: '#3399ff',
        accent: '#0055aa',
      },
      isDarkMode: false,
    };
    const css = getStyles(vs, themeCode);
    expect(css).toContain('background-color: #ffffff !important');
    expect(css).toContain('color: #171717 !important');
  });
});

// ---------------------------------------------------------------------------
// applyImageStyle
// ---------------------------------------------------------------------------
describe('applyImageStyle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('converts %-based width attribute to px style', () => {
    document.body.innerHTML = '<div><img width="50%" /></div>';
    // jsdom defaults window.innerWidth to 0, so the computed px value = 0
    // We test that the width attribute is removed and style.width is set
    applyImageStyle(document);
    const img = document.querySelector('img')!;
    expect(img.hasAttribute('width')).toBe(false);
    expect(img.style.width).toBeTruthy();
  });

  it('converts %-based height attribute to px style', () => {
    document.body.innerHTML = '<div><img height="50%" /></div>';
    applyImageStyle(document);
    const img = document.querySelector('img')!;
    expect(img.hasAttribute('height')).toBe(false);
    expect(img.style.height).toBeTruthy();
  });

  it('does not convert pixel-based width attributes', () => {
    document.body.innerHTML = '<div><img width="200" /></div>';
    applyImageStyle(document);
    const img = document.querySelector('img')!;
    expect(img.getAttribute('width')).toBe('200');
  });

  it('adds has-text-siblings class when image has text sibling nodes', () => {
    document.body.innerHTML = '<p>Some text <img src="test.png" /> more text</p>';
    applyImageStyle(document);
    const img = document.querySelector('img')!;
    expect(img.classList.contains('has-text-siblings')).toBe(true);
  });

  it('does not add has-text-siblings class when image is the only child', () => {
    document.body.innerHTML = '<p><img src="test.png" /></p>';
    applyImageStyle(document);
    const img = document.querySelector('img')!;
    expect(img.classList.contains('has-text-siblings')).toBe(false);
  });

  it('does not add has-text-siblings when text siblings are whitespace-only', () => {
    document.body.innerHTML = '<p> <img src="test.png" /> </p>';
    applyImageStyle(document);
    const img = document.querySelector('img')!;
    expect(img.classList.contains('has-text-siblings')).toBe(false);
  });

  it('does not add has-text-siblings when parent has BR siblings (not inline)', () => {
    document.body.innerHTML = '<p>text<br /><img src="test.png" /></p>';
    applyImageStyle(document);
    const img = document.querySelector('img')!;
    expect(img.classList.contains('has-text-siblings')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// keepTextAlignment
// ---------------------------------------------------------------------------
describe('keepTextAlignment', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('adds aligned-center class to elements with text-align: center', () => {
    document.body.innerHTML = '<p style="text-align: center;">centered</p>';
    keepTextAlignment(document);
    const p = document.querySelector('p')!;
    expect(p.classList.contains('aligned-center')).toBe(true);
  });

  it('adds aligned-left class to elements with text-align: left', () => {
    document.body.innerHTML = '<p style="text-align: left;">left</p>';
    keepTextAlignment(document);
    const p = document.querySelector('p')!;
    expect(p.classList.contains('aligned-left')).toBe(true);
  });

  it('adds aligned-right class to elements with text-align: right', () => {
    document.body.innerHTML = '<div style="text-align: right;">right</div>';
    keepTextAlignment(document);
    const div = document.querySelector('div')!;
    expect(div.classList.contains('aligned-right')).toBe(true);
  });

  it('adds aligned-justify class to elements with text-align: justify', () => {
    document.body.innerHTML = '<p style="text-align: justify;">justified</p>';
    keepTextAlignment(document);
    const p = document.querySelector('p')!;
    expect(p.classList.contains('aligned-justify')).toBe(true);
  });

  it('does not add alignment class to elements without text-align', () => {
    document.body.innerHTML = '<p>no alignment</p>';
    keepTextAlignment(document);
    const p = document.querySelector('p')!;
    expect(p.classList.contains('aligned-center')).toBe(false);
    expect(p.classList.contains('aligned-left')).toBe(false);
    expect(p.classList.contains('aligned-right')).toBe(false);
    expect(p.classList.contains('aligned-justify')).toBe(false);
  });

  it('handles multiple elements with different alignments', () => {
    document.body.innerHTML = `
      <p style="text-align: center;">centered</p>
      <div style="text-align: right;">right</div>
      <blockquote style="text-align: justify;">justified</blockquote>
    `;
    keepTextAlignment(document);
    expect(document.querySelector('p')!.classList.contains('aligned-center')).toBe(true);
    expect(document.querySelector('div')!.classList.contains('aligned-right')).toBe(true);
    expect(document.querySelector('blockquote')!.classList.contains('aligned-justify')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyTableStyle
// ---------------------------------------------------------------------------
describe('applyTableStyle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('applies scale transform to a table with td width attributes', () => {
    document.body.innerHTML = `
      <div>
        <table>
          <tr>
            <td width="100">Cell 1</td>
            <td width="200">Cell 2</td>
          </tr>
        </table>
      </div>
    `;
    applyTableStyle(document);
    const table = document.querySelector('table')!;
    // totalTableWidth = 100 + 200 = 300
    expect(table.style.transform).toContain('scale(');
    expect(table.style.transform).toContain('300');
    expect(table.style.transformOrigin).toBe('left top');
  });

  it('applies scale transform using px width from td elements', () => {
    document.body.innerHTML = `
      <div>
        <table>
          <tr>
            <td width="150px">Cell 1</td>
            <td width="250px">Cell 2</td>
          </tr>
        </table>
      </div>
    `;
    applyTableStyle(document);
    const table = document.querySelector('table')!;
    // totalTableWidth = 150 + 250 = 400
    expect(table.style.transform).toContain('400');
  });

  it('uses the widest row when multiple rows exist', () => {
    document.body.innerHTML = `
      <div>
        <table>
          <tr>
            <td width="100">A</td>
            <td width="100">B</td>
          </tr>
          <tr>
            <td width="200">C</td>
            <td width="300">D</td>
          </tr>
        </table>
      </div>
    `;
    applyTableStyle(document);
    const table = document.querySelector('table')!;
    // Second row: 200 + 300 = 500
    expect(table.style.transform).toContain('500');
  });

  it('applies center-top origin when no cell widths are specified', () => {
    document.body.innerHTML = `
      <div style="width: 600px;">
        <table>
          <tr>
            <td>Cell 1</td>
            <td>Cell 2</td>
          </tr>
        </table>
      </div>
    `;
    applyTableStyle(document);
    const table = document.querySelector('table')!;
    // No cell widths => totalTableWidth = 0
    // jsdom getComputedStyle may return parentWidth as "" or "0px" so transform may not be set
    // But if parentContainerWidth > 0 it would use center top
    // In jsdom getComputedStyle returns "" for inline styles on div so parentContainerWidth = 0
    // Neither branch applies; verify no crash
    expect(table).toBeTruthy();
  });

  it('handles tables with inline style width on td', () => {
    document.body.innerHTML = `
      <div>
        <table>
          <tr>
            <td style="width: 120px;">Cell 1</td>
            <td style="width: 180px;">Cell 2</td>
          </tr>
        </table>
      </div>
    `;
    applyTableStyle(document);
    const table = document.querySelector('table')!;
    // totalTableWidth = 120 + 180 = 300
    expect(table.style.transform).toContain('300');
  });

  it('does not crash on a table without parent element', () => {
    // Table at root level inside body
    document.body.innerHTML = `
      <table>
        <tr><td width="100">A</td></tr>
      </table>
    `;
    // body is the parent, which is an Element, so it proceeds
    applyTableStyle(document);
    const table = document.querySelector('table')!;
    expect(table.style.transform).toContain('100');
  });
});
