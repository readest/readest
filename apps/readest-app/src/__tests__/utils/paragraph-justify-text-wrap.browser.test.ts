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

// Standard Ebooks core.css sets `text-wrap: pretty` on <body>. Engines that
// apply `pretty` to justified text (Safari 26+, recent Chromium) overshoot
// inter-word spacing when it combines with the reader's full justification,
// and the Word Spacing setting stops having any visible effect (#5582).
// When justification is on, the reader owns line breaking: the authored wrap
// style must be neutralized. When justification is off the authored style is
// harmless (better rag) and must survive.
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

// Mirrors the paginator's injection order: the book's author CSS is already in
// <head> and the reader's generated stylesheet is appended at the end of it.
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

const SE_BODY_CSS = `body { font-variant-numeric: oldstyle-nums; hyphens: auto; text-wrap: pretty; }`;

afterEach(() => {
  while (iframes.length) iframes.pop()!.remove();
});

describe('authored text-wrap: pretty vs full justification (#5582)', () => {
  test('neutralizes body-level pretty on paragraphs when justification is on', () => {
    const { doc, win } = renderSection(SE_BODY_CSS, `<p class="para">In search of lost time.</p>`, {
      fullJustification: true,
    });
    const para = doc.querySelector('.para') as HTMLElement;
    expect(win.getComputedStyle(para).textAlign).toBe('justify');
    expect(win.getComputedStyle(para).getPropertyValue('text-wrap-style')).toBe('auto');
  });

  test('neutralizes pretty authored directly on paragraphs when justification is on', () => {
    const { doc, win } = renderSection(
      `p { text-wrap: pretty; }`,
      `<p class="para">In search of lost time.</p>`,
      { fullJustification: true },
    );
    const para = doc.querySelector('.para') as HTMLElement;
    expect(win.getComputedStyle(para).getPropertyValue('text-wrap-style')).toBe('auto');
  });

  test('keeps the authored pretty when justification is off', () => {
    const { doc, win } = renderSection(SE_BODY_CSS, `<p class="para">In search of lost time.</p>`, {
      fullJustification: false,
    });
    const para = doc.querySelector('.para') as HTMLElement;
    expect(win.getComputedStyle(para).getPropertyValue('text-wrap-style')).toBe('pretty');
  });

  test('preserves authored nowrap while justification is on', () => {
    // The neutralization must target the wrap *style* longhand only — an
    // authored `text-wrap: nowrap` (mode) still has to stick.
    const { doc, win } = renderSection(
      `${SE_BODY_CSS} p.nowrap { text-wrap: nowrap; }`,
      `<p class="nowrap">Do not wrap this line.</p>`,
      { fullJustification: true },
    );
    const para = doc.querySelector('.nowrap') as HTMLElement;
    expect(win.getComputedStyle(para).getPropertyValue('text-wrap-mode')).toBe('nowrap');
  });

  test('leaves balance on headings alone while justification is on', () => {
    // Headings are not justified; balanced headings are a legitimate authored
    // choice that must survive the paragraph-level neutralization.
    const { doc, win } = renderSection(
      `${SE_BODY_CSS} h1 { text-align: center; text-wrap: balance; }`,
      `<h1 class="hd">A Balanced Heading</h1>`,
      { fullJustification: true },
    );
    const heading = doc.querySelector('.hd') as HTMLElement;
    expect(win.getComputedStyle(heading).getPropertyValue('text-wrap-style')).toBe('balance');
  });
});
