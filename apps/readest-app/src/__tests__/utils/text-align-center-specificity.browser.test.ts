import { describe, test, expect, afterEach } from 'vitest';

import { getStyles, keepTextAlignment, transformStylesheet, ThemeCode } from '@/utils/style';
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

// A heading rule that centers with a zero indent must not outrank a more
// specific author rule that left-aligns one of those headings (#6723).
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
  bookStyle.textContent = transformStylesheet(bookCss, 800, 600, false);
  doc.head.appendChild(bookStyle);
  const readerStyle = doc.createElement('style');
  readerStyle.textContent = getStyles(makeViewSettings(settings), themeCode);
  doc.head.appendChild(readerStyle);
  doc.body.innerHTML = bodyHtml;
  keepTextAlignment(doc);
  return { doc, win: iframe.contentWindow! };
};

const BOOK_CSS = `
  h1, h2 { text-indent: 0; text-align: center; }
  .vsides { text-indent: 0; text-align: left; padding-left: 0.5em; }
  p { text-indent: 2em; text-align: justify; }
  .center { text-indent: 0; text-align: center; }
`;

const BODY = `
  <h2 id="heading" class="vsides">亲近文学</h2>
  <p id="centered" class="center">梅子涵</p>
`;

afterEach(() => {
  while (iframes.length) iframes.pop()!.remove();
});

describe('text-align center + text-indent 0 specificity (#6723)', () => {
  for (const overrideLayout of [false, true]) {
    test(`a more specific left-align wins over a centered heading rule (override ${overrideLayout})`, () => {
      const { doc, win } = renderSection(BOOK_CSS, BODY, { overrideLayout });
      expect(win.getComputedStyle(doc.getElementById('heading')!).textAlign).toBe('left');
    });

    test(`a centered zero-indent paragraph stays centered and unindented (override ${overrideLayout})`, () => {
      const { doc, win } = renderSection(BOOK_CSS, BODY, {
        overrideLayout,
        fullJustification: true,
        textIndent: 2,
      });
      const style = win.getComputedStyle(doc.getElementById('centered')!);
      expect(style.textAlign).toBe('center');
      expect(style.textIndent).toBe('0px');
    });
  }
});
