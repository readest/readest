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

// Override Book Color paints text spans with the theme's text color, and that
// rule also hit the spans a book puts inside its links. A footnote marker like
// <a href="#n1"><span>¶</span></a> then showed in plain text color, with only
// the hover underline left to tell it was a link (#7573).
const baseSettings = {
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

const FG = 'rgb(224, 224, 224)';
const PRIMARY = 'rgb(119, 187, 238)';
const LIGHTBLUE = 'rgb(173, 216, 230)';

const themeCode = {
  bg: '#222222',
  fg: '#e0e0e0',
  primary: '#77bbee',
  isDarkMode: true,
  palette: {
    'base-100': '#222222',
    'base-200': '#2a2a2a',
    'base-300': '#333333',
    'base-content': '#e0e0e0',
    neutral: '#808080',
    'neutral-content': '#ffffff',
    primary: '#77bbee',
    secondary: '#6699cc',
    accent: '#33cc99',
  },
} as ThemeCode;

// Link shapes from the reporter's sample book, plus text that isn't a link.
const BOOK_HTML = `
  <p id="plain">Text <span id="plain-span" class="c9">with a span</span>.</p>
  <p>Text<a href="#n1" id="bare">[2]</a></p>
  <p>Text<a href="#n2"><span id="span" class="c9">¶</span></a></p>
  <p>Text<a href="#n3"><span class="i"><span id="nested" class="c1">‡‡</span></span></a></p>
  <p>Text<a href="#n4"><sup id="sup">1</sup></a></p>
  <p>Text<a href="#n5"><font id="font">*</font></a></p>
  <div><a href="#n6"><div id="div-in-link">Back</div></a></div>
  <p><span class="cite" id="span-around-link"><a href="#n7" id="link-in-span">[3]</a></span></p>
  <p>Text<a id="anchor"><span id="span-in-anchor">not a link</span></a></p>
`;

const BOOK_CSS = '.c9 { color: #000; } .c1 { color: #7f7f7f; }';

const added: Element[] = [];

const render = (overrideColor: boolean) => {
  const settings = { ...baseSettings, overrideColor };
  for (const css of [BOOK_CSS, getStyles(settings, themeCode)]) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    added.push(style);
  }
  const container = document.createElement('div');
  container.innerHTML = BOOK_HTML;
  document.body.appendChild(container);
  added.push(container);
};

const color = (id: string) => getComputedStyle(document.getElementById(id)!).color;

describe('Override Book Color keeps link color inside links (#7573)', () => {
  afterEach(() => {
    for (const el of added.splice(0)) el.remove();
  });

  test('text inside a link takes the link color', () => {
    render(true);
    expect(color('bare')).toBe(PRIMARY);
    expect(color('span')).toBe(PRIMARY);
    expect(color('nested')).toBe(PRIMARY);
    expect(color('sup')).toBe(PRIMARY);
    expect(color('font')).toBe(PRIMARY);
    expect(color('div-in-link')).toBe(PRIMARY);
    expect(color('link-in-span')).toBe(PRIMARY);
  });

  test('text outside links keeps the theme text color', () => {
    render(true);
    expect(color('plain')).toBe(FG);
    expect(color('plain-span')).toBe(FG);
    expect(color('span-around-link')).toBe(FG);
    // an <a> without href is an anchor, not a link
    expect(color('span-in-anchor')).toBe(FG);
  });

  test('with Override Book Color off, the book colors stay as they were', () => {
    render(false);
    expect(color('bare')).toBe(LIGHTBLUE);
    expect(color('span')).toBe('rgb(0, 0, 0)');
    expect(color('nested')).toBe('rgb(127, 127, 127)');
    expect(color('sup')).toBe(LIGHTBLUE);
    expect(color('plain-span')).toBe('rgb(0, 0, 0)');
    expect(color('span-in-anchor')).toBe(FG);
  });
});
