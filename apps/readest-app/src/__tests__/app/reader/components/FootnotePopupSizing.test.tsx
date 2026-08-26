import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// A popup built from a data/alt attribute measures its text synchronously and
// sizes the box to the result. It used to be pinned at the seed height on every
// open, because the size effect keyed on the trigger position ran after the
// commit and threw that measurement away.

const PARAGRAPH_HEIGHT = 152;

const h = vi.hoisted(() => ({
  viewSettings: { vertical: false, scrolled: false },
  dispatchFootnote: (() => {}) as (detail: unknown) => void,
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: true } }) }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ getView: () => null, getViewSettings: () => h.viewSettings }),
}));
vi.mock('@/store/bookDataStore', () => {
  const store = (selector?: (s: unknown) => unknown) =>
    selector ? selector({ booksData: {} }) : { getBookData: () => ({ book: {} }) };
  store.getState = () => ({ booksData: {} });
  return { useBookDataStore: store };
});
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: { getState: () => ({ isDarkMode: false }) },
  getThemeCode: () => ({}),
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [] }),
}));
vi.mock('../hooks/useFoliateEvents', () => ({ useFoliateEvents: () => {} }));
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: () => {} }));
vi.mock('foliate-js/footnotes.js', () => ({
  FootnoteHandler: class {
    addEventListener() {}
    removeEventListener() {}
    handle() {
      return undefined;
    }
  },
}));
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: (name: string, cb: (e: CustomEvent) => void) => {
      if (name === 'footnote-popup') h.dispatchFootnote = (detail) => cb({ detail } as CustomEvent);
    },
    off: () => {},
    dispatch: () => {},
  },
}));

import FootnotePopup from '@/app/reader/components/FootnotePopup';
import { BookDoc } from '@/libs/document';

const footnoteBox = () => document.querySelector<HTMLElement>('.footnote-content');

beforeEach(() => {
  // jsdom has no ResizeObserver, and Popup keeps one on its container.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  cell.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: 400, bottom: 800, width: 400, height: 800 }) as DOMRect;
  document.body.appendChild(cell);
  // jsdom lays nothing out, so the hidden measuring paragraph reports its height
  // here — everything else keeps the zero rect.
  vi.spyOn(HTMLParagraphElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 360,
    height: PARAGRAPH_HEIGHT,
  } as DOMRect);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.getElementById('gridcell-book-1')?.remove();
  cleanup();
});

describe('footnote popup built from a data/alt attribute', () => {
  test('keeps the height it measured for the text', () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    act(() => {
      h.dispatchFootnote({
        bookKey: 'book-1',
        element: document.createElement('a'),
        footnote: 'A footnote long enough to wrap over several lines.',
      });
    });

    expect(footnoteBox()?.style.height).toBe(`${PARAGRAPH_HEIGHT}px`);
  });
});
