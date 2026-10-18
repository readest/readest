import { describe, test, expect, afterEach } from 'vitest';
import { userEvent } from 'vitest/browser';

import { getStyles, ThemeCode } from '@/utils/style';
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

// The reader takes the underline off links, and its rule comes after the
// book's CSS with the same specificity as `a:hover`, so a book's own hover
// style lost to it unless marked !important (#6859). Hovering is left to the
// book; the default stays for links that aren't hovered.
const settings = {
  ...DEFAULT_BOOK_FONT,
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_BOOK_LANGUAGE,
  ...DEFAULT_BOOK_STYLE,
  ...DEFAULT_VIEW_CONFIG,
  ...DEFAULT_TTS_CONFIG,
  ...DEFAULT_TRANSLATOR_CONFIG,
  ...DEFAULT_ANNOTATOR_CONFIG,
  ...DEFAULT_SCREEN_CONFIG,
} as ViewSettings;

const themeCode = {
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
} as ThemeCode;

const added: Element[] = [];

// The book's CSS first, then the reader's, as the paginator injects them
const renderLink = (bookCss: string) => {
  for (const css of [bookCss, getStyles(settings, themeCode)]) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    added.push(style);
  }
  const link = document.createElement('a');
  link.href = '#note';
  link.textContent = 'a link';
  document.body.appendChild(link);
  added.push(link);
  return link;
};

const decoration = (el: Element) => getComputedStyle(el).textDecorationLine;

describe('link underline and a book hover style (#6859)', () => {
  afterEach(async () => {
    await userEvent.unhover(document.body);
    for (const el of added.splice(0)) el.remove();
  });

  test("a book's a:hover underline applies on hover", async () => {
    const link = renderLink('a:hover { text-decoration: underline; }');
    expect(decoration(link)).toBe('none');

    await userEvent.hover(link);

    expect(decoration(link)).toBe('underline');
  });

  test('a link that is not hovered still has no underline', () => {
    const link = renderLink('a { text-decoration: underline; }');

    expect(decoration(link)).toBe('none');
  });

  // The default keeps its specificity, so a more specific book rule still wins
  test('a more specific book link rule still wins when not hovered', () => {
    const link = renderLink('body a[href] { text-decoration: underline; }');

    expect(decoration(link)).toBe('underline');
  });
});
