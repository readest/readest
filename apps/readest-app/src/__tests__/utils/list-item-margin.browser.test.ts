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

// Normal mode keeps a book's li margins as written. Override Book Layout drops
// the end side, which only wastes width at each list level. The start side has to survive even then: with `ul { padding: 0 }`
// it is what keeps an outside marker on the page. These run the real cascade,
// book CSS first and the reader's stylesheet after it, as the paginator injects
// them.
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

const BOOK_CSS = 'li { margin: 0 2em; }';

const renderList = (bookCss: string, settings: Partial<ViewSettings>, htmlAttrs = '') => {
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
  if (htmlAttrs) doc.documentElement.setAttribute('style', htmlAttrs);
  doc.body.innerHTML = `<ul class="exe"><li class="item">One<ul><li>Nested</li></ul></li></ul><ol><li>Two</li></ol>`;
  return iframe;
};

const liMargins = (bookCss: string, settings: Partial<ViewSettings>, htmlAttrs = '') => {
  const iframe = renderList(bookCss, settings, htmlAttrs);
  const li = iframe.contentDocument!.querySelector('li') as HTMLElement;
  const cs = iframe.contentWindow!.getComputedStyle(li);
  return {
    left: cs.marginLeft,
    right: cs.marginRight,
    top: cs.marginTop,
    bottom: cs.marginBottom,
  };
};

const listPadding = (
  selector: string,
  bookCss: string,
  settings: Partial<ViewSettings>,
  htmlAttrs = '',
) => {
  const iframe = renderList(bookCss, settings, htmlAttrs);
  const list = iframe.contentDocument!.querySelector(selector) as HTMLElement;
  const cs = iframe.contentWindow!.getComputedStyle(list);
  return { left: cs.paddingLeft, right: cs.paddingRight };
};

afterEach(() => {
  while (iframes.length) iframes.pop()!.remove();
});

describe('list item end margin', () => {
  const override = { overrideLayout: true };

  test('keeps the book margins as written in normal mode', () => {
    expect(liMargins(BOOK_CSS, {})).toMatchObject({ left: '32px', right: '32px' });
  });

  test('keeps the book margins under Use Book Layout', () => {
    expect(liMargins(BOOK_CSS, { useBookLayout: true })).toMatchObject({
      left: '32px',
      right: '32px',
    });
  });

  test('drops only the end margin under Override Book Layout', () => {
    expect(liMargins(BOOK_CSS, override)).toMatchObject({ left: '32px', right: '0px' });
  });

  test('drops the end margin of a class rule under Override Book Layout', () => {
    expect(liMargins('li.item { margin: 0 2em; }', override).right).toBe('0px');
    expect(liMargins('ul li { margin-right: 2em; }', override).right).toBe('0px');
  });

  test('keeps the start margin that holds an outside marker on the page', () => {
    const css = 'ul { padding: 0; } li { margin-left: 2em; }';
    expect(liMargins(css, override).left).toBe('32px');
  });

  test('follows the inline axis in right-to-left text', () => {
    expect(liMargins(BOOK_CSS, override, 'direction: rtl')).toMatchObject({
      left: '0px',
      right: '32px',
    });
  });

  test('follows the inline axis in vertical text', () => {
    const css = 'li { margin: 2em 0; }';
    expect(liMargins(css, override, 'writing-mode: vertical-rl')).toMatchObject({
      top: '32px',
      bottom: '0px',
    });
  });
});

// The browser gives every list a 40px start padding that the book never asked
// for. Override Book Layout shrinks that default and nothing the book wrote.
describe('default list indent', () => {
  const override = { overrideLayout: true };

  test('keeps the browser default in normal mode', () => {
    expect(listPadding('ul', '', {}).left).toBe('40px');
    expect(listPadding('ol', '', {}).left).toBe('40px');
  });

  test('keeps the browser default under Use Book Layout', () => {
    expect(listPadding('ul', '', { useBookLayout: true }).left).toBe('40px');
  });

  test('shrinks the default under Override Book Layout', () => {
    expect(listPadding('ul', '', override).left).toBe('24px');
    expect(listPadding('ol', '', override).left).toBe('24px');
  });

  test('shrinks the default for a list the book only gives li margins', () => {
    expect(listPadding('ul', BOOK_CSS, override).left).toBe('24px');
  });

  test('keeps an indent the book wrote under Override Book Layout', () => {
    expect(listPadding('ul', 'ul { padding: 0; }', override).left).toBe('0px');
    expect(listPadding('ul', 'ul { padding-left: 3em; }', override).left).toBe('48px');
    expect(listPadding('ul', 'ul.exe { padding: 1em 1.3em; }', override)).toMatchObject({
      left: '20.8px',
      right: '20.8px',
    });
  });

  test('never indents more than the browser default at a large font size', () => {
    const large = { ...override, defaultFontSize: 40 };
    expect(listPadding('ul', '', large).left).toBe('40px');
    expect(listPadding('ul ul', '', large).left).toBe('40px');
  });

  test('keeps a universal reset under Override Book Layout', () => {
    expect(listPadding('ul', '* { padding: 0; }', override).left).toBe('0px');
  });

  test('follows the inline axis in right-to-left text', () => {
    expect(listPadding('ul', '', override, 'direction: rtl')).toMatchObject({
      left: '0px',
      right: '24px',
    });
  });
});
