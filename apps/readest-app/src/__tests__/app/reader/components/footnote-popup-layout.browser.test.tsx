import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import type { BookDoc } from '@/libs/document';
import type { ViewSettings } from '@/types/book';
import {
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_VIEW_CONFIG,
} from '@/services/constants';
import FootnotePopup from '@/app/reader/components/FootnotePopup';
import '@/styles/globals.css';

const h = vi.hoisted(() => ({
  viewSettings: {} as ViewSettings,
  mainView: new EventTarget(),
  handlers: [] as EventTarget[],
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: false } }) }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => h.mainView,
    getViewSettings: () => h.viewSettings,
  }),
}));
vi.mock('@/store/bookDataStore', () => {
  const state = { booksData: {}, getBookData: () => ({ book: { primaryLanguage: 'en' } }) };
  return {
    useBookDataStore: Object.assign(
      (selector?: (value: typeof state) => unknown) => (selector ? selector(state) : state),
      { getState: () => state },
    ),
  };
});
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: { getState: () => ({ isDarkMode: false }) },
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [] }),
}));
vi.mock('@/styles/fonts', () => ({
  createFontCSS: () => '',
  mountAdditionalFonts: () => {},
  mountCustomFont: () => {},
}));
vi.mock('foliate-js/footnotes.js', () => {
  class FootnoteHandler extends EventTarget {
    constructor() {
      super();
      h.handlers.push(this);
    }
    handle() {
      return Promise.resolve();
    }
  }
  return { FootnoteHandler };
});

let cell: HTMLElement;
let anchor: HTMLAnchorElement;

beforeEach(() => {
  h.viewSettings = {
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LANGUAGE,
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_VIEW_CONFIG,
    overrideLayout: true,
    fullJustification: false,
  } as ViewSettings;
  h.handlers.length = 0;
  cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  cell.style.cssText = 'position:fixed;inset:0;';
  anchor = document.createElement('a');
  anchor.href = 'notes.xhtml#note';
  anchor.textContent = 'Footnote';
  anchor.style.cssText = 'position:absolute;left:40px;top:120px;';
  cell.appendChild(anchor);
  document.body.appendChild(cell);
});

afterEach(() => {
  act(() => {
    document.querySelector<HTMLElement>('.overlay')?.click();
  });
  cleanup();
  cell.remove();
});

const openFootnote = (direction: 'ltr' | 'rtl' = 'ltr') => {
  h.viewSettings.rtl = direction === 'rtl';
  render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
  act(() => {
    h.mainView.dispatchEvent(
      new CustomEvent('link', { detail: { a: anchor, href: anchor.getAttribute('href') } }),
    );
  });
  const view = document.createElement('foliate-view');
  const iframe = document.createElement('iframe');
  view.appendChild(iframe);
  Object.defineProperty(view, 'renderer', {
    value: {
      viewSize: 220,
      setAttribute: () => {},
      getContents: () => [{ doc: iframe.contentDocument!, index: 0 }],
      setStyles: (css: string) => {
        // The popup has attached the view before styling its document.
        const doc = iframe.contentDocument!;
        doc.documentElement.dir = direction;
        doc.head.innerHTML = '<style>.authored-justify { text-align: justify; }</style>';
        doc.body.innerHTML = `
          <p id="css-justify" class="authored-justify">A footnote justified by the book stylesheet.</p>
          <p id="inline-justify" style="text-align: justify">A footnote justified by an inline style.</p>
          <p id="left" style="text-align: left">Left-aligned prose.</p>
          <p id="center" style="text-align: center">Centered text.</p>
          <p id="right" style="text-align: right">Right-aligned text.</p>
        `;
        const style = doc.createElement('style');
        style.textContent = css;
        doc.head.appendChild(style);
      },
    },
  });
  Object.defineProperty(view, 'close', { value: () => {} });
  const handler = h.handlers.at(-1)!;
  // The real paginator injects the app CSS before dispatching document load.
  act(() => {
    handler.dispatchEvent(new CustomEvent('before-render', { detail: { view } }));
  });
  const doc = iframe.contentDocument!;
  act(() => {
    view.dispatchEvent(new CustomEvent('load', { detail: { doc, index: 0 } }));
    handler.dispatchEvent(
      new CustomEvent('render', {
        detail: { view, href: anchor.getAttribute('href'), index: 0, extract: null },
      }),
    );
    view.dispatchEvent(new CustomEvent('relocate'));
  });
  return doc;
};

const expectAlignment = (doc: Document, justified: string, left: string) => {
  const alignment = (id: string) =>
    doc.defaultView!.getComputedStyle(doc.getElementById(id)!).textAlign;
  expect(alignment('css-justify')).toBe(justified);
  expect(alignment('inline-justify')).toBe(justified);
  expect(alignment('left')).toBe(left);
  expect(alignment('center')).toBe('center');
  expect(alignment('right')).toBe('right');
};

describe('footnote popup layout overrides (#6636)', () => {
  test.each(['ltr', 'rtl'] as const)('disables authored justification in %s', (direction) => {
    const doc = openFootnote(direction);
    expectAlignment(doc, 'start', 'left');
    expect(doc.defaultView!.getComputedStyle(doc.body).direction).toBe(direction);
  });

  test('justifies left-aligned prose when Full Justification is enabled', () => {
    h.viewSettings.fullJustification = true;
    expectAlignment(openFootnote(), 'justify', 'justify');
  });

  test('retains authored alignment when Override Book Layout is disabled', () => {
    h.viewSettings.overrideLayout = false;
    expectAlignment(openFootnote(), 'justify', 'left');
  });

  test('retains authored alignment when Use Book Layout is enabled', () => {
    h.viewSettings.useBookLayout = true;
    expectAlignment(openFootnote(), 'justify', 'left');
  });
});
