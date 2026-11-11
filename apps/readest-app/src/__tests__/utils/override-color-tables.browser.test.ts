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

// Override Book Color must beat a book's own table colors (#7415). These read
// the resolved backgrounds in a real engine: which rule wins is decided by
// !important and specificity together, which the emitted CSS text can't show.
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

const makeTheme = (isDarkMode: boolean): ThemeCode =>
  ({
    bg: isDarkMode ? '#1a1a1a' : '#fafafa',
    fg: isDarkMode ? '#e0e0e0' : '#111111',
    primary: '#3366cc',
    isDarkMode,
    palette: {},
  }) as ThemeCode;

const BOOK_CSS = `
  col { background-color: #ff0000; }
  tr { background-color: #00ff00; }
  td { background-color: #ffcc00; }
  b { background-color: #0000ff; }
`;

const TABLE_HTML = `
  <table>
    <colgroup><col id="col"></colgroup>
    <tr id="tr">
      <td id="td" style="background-image: linear-gradient(#ffffff, #ffffff)">
        <b id="b">bold</b><p id="p">text</p>
      </td>
    </tr>
  </table>
`;

const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const iframes: HTMLIFrameElement[] = [];

// Mirrors the paginator's injection order: the book's CSS is already in <head>
// and the reader's generated stylesheet is appended after it.
const renderTable = (settings: Partial<ViewSettings>, isDarkMode = false) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframes.push(iframe);
  const doc = iframe.contentDocument!;
  const bookStyle = doc.createElement('style');
  bookStyle.textContent = BOOK_CSS;
  doc.head.appendChild(bookStyle);
  const readerStyle = doc.createElement('style');
  readerStyle.textContent = getStyles(makeViewSettings(settings), makeTheme(isDarkMode));
  doc.head.appendChild(readerStyle);
  doc.body.innerHTML = TABLE_HTML;
  const style = (id: string) => iframe.contentWindow!.getComputedStyle(doc.getElementById(id)!);
  return {
    bg: (id: string) => style(id).backgroundColor,
    image: (id: string) => style(id).backgroundImage,
  };
};

afterEach(() => {
  iframes.splice(0).forEach((iframe) => iframe.remove());
});

describe('Override Book Color on tables (#7415)', () => {
  test('paints cells, rows and columns with the theme background', () => {
    const { bg, image } = renderTable({ overrideColor: true });
    const theme = 'rgb(250, 250, 250)';
    expect(bg('td')).toBe(theme);
    expect(bg('tr')).toBe(theme);
    expect(bg('col')).toBe(theme);
    expect(image('td')).toBe('none');
  });

  test("leaves the book's table colors alone when the override is off", () => {
    const { bg, image } = renderTable({ overrideColor: false });
    expect(bg('td')).toBe('rgb(255, 204, 0)');
    expect(bg('col')).toBe('rgb(255, 0, 0)');
    expect(image('td')).not.toBe('none');
  });

  test('keeps the whole table transparent over a background texture', () => {
    for (const isDarkMode of [false, true]) {
      const { bg, image } = renderTable(
        { overrideColor: true, backgroundTextureId: 'paper' },
        isDarkMode,
      );
      for (const id of ['col', 'tr', 'td', 'b', 'p']) expect(bg(id), id).toBe(TRANSPARENT);
      expect(image('td')).toBe('none');
    }
  });

  test('paints no second shade behind text inside a cell in dark mode', () => {
    const { bg } = renderTable({ overrideColor: true }, true);
    expect(bg('td')).not.toBe('rgb(255, 204, 0)');
    expect(bg('b')).toBe(TRANSPARENT);
    expect(bg('p')).toBe(TRANSPARENT);
  });
});
