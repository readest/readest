import { describe, test, expect, afterEach } from 'vitest';

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

// Some Calibre (MOBI) conversions mark up every paragraph as an inline-only
// <blockquote> with an indenting class. Override Book Layout must give those
// the Paragraph Margin and drop the authored side margins, like a <p> (#6656).
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

const themeCode: ThemeCode = {
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

const iframes: HTMLIFrameElement[] = [];

const renderSection = (bookCss: string, bodyHtml: string, settings: Partial<ViewSettings>) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframes.push(iframe);
  const doc = iframe.contentDocument!;
  const bookStyle = doc.createElement('style');
  bookStyle.textContent = bookCss;
  doc.head.appendChild(bookStyle);
  const readerStyle = doc.createElement('style');
  readerStyle.textContent = getStyles(makeViewSettings(settings), themeCode);
  doc.head.appendChild(readerStyle);
  doc.body.innerHTML = bodyHtml;
  return { doc, win: iframe.contentWindow! };
};

const CALIBRE_CSS = `
  .calibre9 { display: block; margin: 0 0 0 2em; text-align: justify; text-indent: 2em; }
  .quote { margin: 1em 3em; }
`;

afterEach(() => {
  while (iframes.length) iframes.pop()!.remove();
});

describe('paragraph-like blockquote margins (#6656)', () => {
  test('override applies the paragraph margin and drops side margins', () => {
    const { doc, win } = renderSection(
      CALIBRE_CSS,
      `<blockquote class="calibre9">He came <span>one late</span>, wet spring.</blockquote>`,
      { overrideLayout: true, paragraphMargin: 0.8, vertical: false },
    );
    const para = win.getComputedStyle(doc.querySelector('.calibre9')!);
    const fontSize = parseFloat(para.fontSize);
    expect(para.marginLeft).toBe('0px');
    expect(para.marginRight).toBe('0px');
    expect(parseFloat(para.marginTop)).toBeCloseTo(0.8 * fontSize, 1);
    expect(parseFloat(para.marginBottom)).toBeCloseTo(0.8 * fontSize, 1);
  });

  test('override keeps the indent of a real block quote', () => {
    const { doc, win } = renderSection(
      CALIBRE_CSS,
      `<blockquote class="quote"><p>Is time the wheel that turns?</p></blockquote>`,
      { overrideLayout: true, paragraphMargin: 0.8, vertical: false },
    );
    const quote = win.getComputedStyle(doc.querySelector('.quote')!);
    expect(parseFloat(quote.marginLeft)).toBeCloseTo(3 * parseFloat(quote.fontSize), 1);
  });

  test('keeps the book margins when override is off', () => {
    const { doc, win } = renderSection(
      CALIBRE_CSS,
      `<blockquote class="calibre9">He came one late, wet spring.</blockquote>`,
      { overrideLayout: false, paragraphMargin: 0.8, vertical: false },
    );
    const para = win.getComputedStyle(doc.querySelector('.calibre9')!);
    expect(parseFloat(para.marginLeft)).toBeCloseTo(2 * parseFloat(para.fontSize), 1);
    expect(para.marginTop).toBe('0px');
  });
});
