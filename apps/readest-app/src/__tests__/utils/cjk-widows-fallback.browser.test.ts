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

// The Use Book Layout root fallback for CJK lives on `html:lang()` at zero
// specificity so the UA default of 2 only applies when the book says nothing
// at all. Cascade mechanics decide every case here: a direct declaration
// beats an inherited value at any specificity (so the fallback must NOT sit
// on the paragraphs themselves, or it would stomp book declarations made on
// html/body and expected to inherit), while a zero-specificity root
// declaration loses to anything the book declares anywhere. These assert the
// resolved widows/orphans in a real engine rather than emitted selector text.
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

// Mirrors the paginator's injection order — the book's author CSS already in
// <head>, the reader's generated stylesheet appended after it — and the
// language transformer's output, which leaves `lang` on the section root
// (#6672 rewrites a mislabeled `en` to the detected CJK there).
const renderSection = (bookLang: string, bookCss: string, settings: Partial<ViewSettings>) => {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  iframes.push(iframe);
  const doc = iframe.contentDocument!;
  doc.documentElement.setAttribute('lang', bookLang);
  const bookStyle = doc.createElement('style');
  bookStyle.textContent = bookCss;
  doc.head.appendChild(bookStyle);
  const readerStyle = doc.createElement('style');
  readerStyle.textContent = getStyles(makeViewSettings(settings), themeCode);
  doc.head.appendChild(readerStyle);
  doc.body.innerHTML = `<p>第一段。</p><p>第二段。</p>`;
  return { doc, win: iframe.contentWindow! };
};

const lineBreakOf = (bookLang: string, bookCss: string, settings: Partial<ViewSettings>) => {
  const { doc, win } = renderSection(bookLang, bookCss, settings);
  const cs = win.getComputedStyle(doc.querySelector('p') as HTMLElement);
  return `${cs.widows}/${cs.orphans}`;
};

afterEach(() => {
  while (iframes.length) iframes.pop()!.remove();
});

describe('CJK widow/orphan root fallback vs Use Book Layout', () => {
  test('fills the UA default of 2 with 1 when the book declares nothing', () => {
    expect(lineBreakOf('zh', '', { useBookLayout: true })).toBe('1/1');
  });

  test('preserves a book declaration inherited from html', () => {
    expect(lineBreakOf('zh', 'html { widows: 3; orphans: 3; }', { useBookLayout: true })).toBe(
      '3/3',
    );
  });

  test('preserves a book declaration on body over the root fallback', () => {
    // html gets the fallback's 1, but the book's direct body declaration wins
    // on body and the paragraphs inherit from it.
    expect(lineBreakOf('zh', 'body { widows: 3; orphans: 3; }', { useBookLayout: true })).toBe(
      '3/3',
    );
  });

  test('preserves a book declaration on the paragraph itself', () => {
    expect(lineBreakOf('zh', 'p { widows: 3; orphans: 3; }', { useBookLayout: true })).toBe('3/3');
  });

  test('preserves a book declaration on an intermediate container', () => {
    const { doc, win } = renderSection('zh', 'div.chapter { widows: 3; orphans: 3; }', {
      useBookLayout: true,
    });
    doc.body.innerHTML = `<div class="chapter"><p>第一段。</p></div><p class="loose">第二段。</p>`;
    const inside = win.getComputedStyle(doc.querySelector('.chapter p') as HTMLElement);
    const outside = win.getComputedStyle(doc.querySelector('p.loose') as HTMLElement);
    expect(`${inside.widows}/${inside.orphans}`).toBe('3/3');
    expect(`${outside.widows}/${outside.orphans}`).toBe('1/1');
  });

  test('does not touch non-CJK books', () => {
    expect(lineBreakOf('en', '', { useBookLayout: true })).toBe('2/2');
  });

  test('stays inert in default mode where the chunk lift answers directly', () => {
    expect(lineBreakOf('zh', '', { useBookLayout: false })).toBe('1/1');
    expect(lineBreakOf('zh', 'p { widows: 3; orphans: 3; }', { useBookLayout: false })).toBe('1/1');
  });
});
