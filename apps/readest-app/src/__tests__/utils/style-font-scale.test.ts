// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest';
import type { ViewSettings } from '@/types/book';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
} from '@/services/constants';

const platform = vi.hoisted(() => ({ os: 'android' }));
vi.mock('@/utils/misc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getOSPlatform: () => platform.os };
});

// Android WebView reports the zoomed size as the computed font-size of a
// probe with `font-size: 100px` (#7972). style.ts measures that once, so each
// test loads a fresh copy of the module under the zoom it wants.
const loadStyle = async (zoom: number, os = 'android') => {
  platform.os = os;
  vi.resetModules();
  const real = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el, pseudo) => {
    const style = real(el, pseudo);
    if ((el as HTMLElement).style?.fontSize !== '100px') return style;
    return { ...style, fontSize: `${100 * zoom}px` } as CSSStyleDeclaration;
  });
  return import('@/utils/style');
};

afterEach(() => {
  vi.restoreAllMocks();
  platform.os = 'android';
});

const scaled = (length: string, zoom = 1.3) =>
  `calc(${length} * var(--readest-font-scale, ${zoom}))`;

describe('book em/rem lengths under the Android text zoom', () => {
  it('leaves book CSS untouched at the default system font size', async () => {
    const { transformStylesheet, transformInlineFonts } = await loadStyle(1);
    const css = 'p { text-indent: 2em; margin: 1em; }';
    expect(transformStylesheet(css, 800, 600, false)).toBe(css);
    expect(transformInlineFonts('text-indent: 2em')).toBe('text-indent: 2em');
  });

  it('leaves book CSS untouched off Android', async () => {
    const { transformStylesheet } = await loadStyle(1.3, 'ios');
    const css = 'p { text-indent: 2em; margin: 1em; }';
    expect(transformStylesheet(css, 800, 600, false)).toBe(css);
  });

  it('scales em/rem layout lengths in stylesheets and style attributes', async () => {
    const { transformStylesheet, transformInlineFonts } = await loadStyle(1.3);
    const result = transformStylesheet(
      'p { text-indent: 2em; margin: 0.5em 1rem; width: 20em; text-shadow: 0 0 .2em black; }',
      800,
      600,
      false,
    );
    expect(result).toContain(`text-indent: ${scaled('2em')}`);
    expect(result).toContain(`margin: ${scaled('0.5em')} ${scaled('1rem')}`);
    expect(result).toContain(`width: ${scaled('20em')}`);
    expect(result).toContain(`text-shadow: 0 0 ${scaled('.2em')} black`);
    expect(transformInlineFonts('text-indent: 2em; margin: -1rem')).toBe(
      `text-indent: ${scaled('2em')}; margin: ${scaled('-1rem')}`,
    );
  });

  it('scales the em height that sets a double-line note column', async () => {
    const { transformStylesheet } = await loadStyle(2);
    const result = transformStylesheet(
      '.jp { height: calc((var(--char-count) / 2) * 1em); }',
      800,
      600,
      true,
    );
    expect(result).toContain(`height: calc((var(--char-count) / 2) * ${scaled('1em', 2)})`);
  });

  it('never scales font sizes or line heights, which the zoom already grows', async () => {
    const { transformStylesheet } = await loadStyle(1.3);
    const result = transformStylesheet(
      'p { font-size: 1.2em; line-height: 1.5em; font: italic 2em/1.4 serif; --font-size: 3em; }',
      800,
      600,
      false,
    );
    expect(result).not.toContain('--readest-font-scale');
  });

  it('leaves custom properties alone, whatever consumes them', async () => {
    const { transformStylesheet } = await loadStyle(1.3);
    const css =
      'p { --base: 1.5em; --heading: var(--base); font-size: var(--heading); --gap: 2em; }';
    expect(transformStylesheet(css, 800, 600, false)).not.toContain('--readest-font-scale');
  });

  it('leaves names, zero, text, url() and at-rule preludes alone', async () => {
    const { transformStylesheet } = await loadStyle(1.3);
    const css =
      '/* 2em */ @media ( min-width: 30em ) { p { margin: var(--gap2em) 0em; animation: slide2em 1s; content: "1em"; background: url(a2em.png); } }';
    expect(transformStylesheet(css, 800, 600, false)).toBe(css);
  });

  it('is idempotent', async () => {
    const { transformStylesheet } = await loadStyle(1.3);
    const once = transformStylesheet('p { text-indent: calc(2em + 1px); }', 800, 600, false);
    expect(once).toContain(`text-indent: calc(${scaled('2em')} + 1px)`);
    expect(transformStylesheet(once, 800, 600, false)).toBe(once);
  });

  it('still drops the negative margins of a painted band (#5711)', async () => {
    const { transformStylesheet } = await loadStyle(1.3);
    const result = transformStylesheet(
      'div.band { background: #eee; margin: 0 -2em; }',
      800,
      600,
      false,
    );
    expect(result).toContain('margin-left: 0 !important; margin-right: 0 !important;');
  });

  it('does not touch fixed-layout books', async () => {
    const { transformStylesheet } = await loadStyle(1.3);
    const css = 'p { text-indent: 2em; margin: 1em; }';
    expect(transformStylesheet(css, 800, 600, false, true)).toBe(css);
  });
});

describe("the reader's own em lengths under the Android text zoom", () => {
  const settings = (overrides: Partial<ViewSettings>) =>
    ({
      ...DEFAULT_BOOK_FONT,
      ...DEFAULT_BOOK_LAYOUT,
      ...DEFAULT_BOOK_STYLE,
      ...DEFAULT_VIEW_CONFIG,
      ...overrides,
    }) as ViewSettings;

  it('scales the paragraph indent and margins', async () => {
    const { getStyles } = await loadStyle(1.3);
    const css = getStyles(settings({ textIndent: 2, paragraphMargin: 1, useBookLayout: false }));
    expect(css).toContain(`text-indent: ${scaled('2em')}`);
    expect(css).toContain(`margin-top: ${scaled('1em')}`);
  });

  it('scales the em sizes it gives inline images and gaiji', async () => {
    const { getStyles } = await loadStyle(1.3);
    const css = getStyles(settings({ vertical: false }));
    expect(css).toMatch(
      /img\[class\*="gaiji"\] \{\s*height: calc\(1em \* var\(--readest-font-scale, 1\.3\)\)/,
    );
    expect(css).toContain(`width: ${scaled('0.8em')}`);
  });

  it('leaves them alone at the default system font size', async () => {
    const { getStyles } = await loadStyle(1);
    const css = getStyles(settings({ textIndent: 2, paragraphMargin: 1, useBookLayout: false }));
    expect(css).toContain('text-indent: 2em');
    expect(css).not.toContain('--readest-font-scale');
  });
});
