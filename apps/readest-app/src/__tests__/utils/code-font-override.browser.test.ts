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

// The monospace fallback is the only rule that applies the app's code font:
// the revert pass deliberately excludes pre/code/kbd, so nothing else covers
// them. Both directions of "Override Book Font" therefore ride on this one
// rule's place in the cascade, and specificity is what decides it - !important
// does not exempt a declaration from the specificity tie-break, it only sorts
// it above the non-important ones. These assert the resolved value in a real
// engine rather than the emitted selector text.
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

const codeFontOf = (bookCss: string, settings: Partial<ViewSettings>) => {
  const { doc, win } = renderSection(bookCss, `<pre class="code">const x = 1;</pre>`, settings);
  const pre = doc.querySelector('.code') as HTMLElement;
  return win.getComputedStyle(pre).fontFamily;
};

afterEach(() => {
  while (iframes.length) iframes.pop()!.remove();
});

describe('code font vs Override Book Font', () => {
  test('lets the book keep its code font when the override is off', () => {
    const font = codeFontOf(`pre { font-family: "BookCode"; }`, { overrideFont: false });
    expect(font).toContain('BookCode');
  });

  test('forces the app monospace over a book code font when the override is on', () => {
    const font = codeFontOf(`pre { font-family: "BookCode"; }`, { overrideFont: true });
    expect(font).toContain('Consolas');
    expect(font).not.toContain('BookCode');
  });

  test('forces the app monospace over an authored !important code font', () => {
    const font = codeFontOf(`pre { font-family: "BookCode" !important; }`, { overrideFont: true });
    expect(font).toContain('Consolas');
    expect(font).not.toContain('BookCode');
  });

  test('forces the app monospace over a more specific authored !important rule', () => {
    const font = codeFontOf(`body pre { font-family: "BookCode" !important; }`, {
      overrideFont: true,
    });
    expect(font).toContain('Consolas');
    expect(font).not.toContain('BookCode');
  });
});
