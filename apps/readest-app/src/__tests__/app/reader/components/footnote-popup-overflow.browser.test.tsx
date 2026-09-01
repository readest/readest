/**
 * Layout of the footnote/note popup box, measured with real CSS.
 *
 * The popup must never grow its own scrollbars around content that already
 * fits (#5999), and the "Jump to Location" chrome must sit where the note's
 * last line runs out rather than over its opening words (#5998).
 *
 * `Popup` applies the requested width/height to `#popup-container` as a
 * border-box and draws a 1px border, so its content box is 2px smaller on each
 * axis. FootnotePopup used to hand the same numbers to `.footnote-content`,
 * which then overflowed by 2px in both directions. `overflow-y-auto` on the
 * container makes `overflow-x` compute to `auto` as well (a `visible` value
 * next to a non-`visible` one becomes `auto`), so the reader saw a vertical
 * *and* a horizontal scrollbar wrapped around the one the popup document
 * already has.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import '@/styles/globals.css';

const h = vi.hoisted(() => ({
  viewSettings: { vertical: false, rtl: false, scrolled: false },
  dispatchFootnote: (() => {}) as (detail: unknown) => void,
  onLinkClick: { current: null as ((event: Event) => void) | null },
  handlers: [] as EventTarget[],
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: false } }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ goTo: () => {} }),
    getViewSettings: () => h.viewSettings,
  }),
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
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({
  useFoliateEvents: (_view: unknown, handlers?: { onLinkClick?: (event: Event) => void }) => {
    h.onLinkClick.current = handlers?.onLinkClick ?? null;
  },
}));
vi.mock('@/app/reader/utils/footnoteHeuristics', () => ({
  shouldCheckAsFootnote: () => false,
  isLinkTargetVisible: () => true,
}));
vi.mock('@/app/reader/utils/annotatorUtil', () => ({ drawAnnotationOverlay: () => {} }));
vi.mock('@/utils/style', () => ({
  getStyles: () => '',
  getFootnoteStyles: () => '',
  getThemeCode: () => ({ bg: '#fff', fg: '#000' }),
}));
vi.mock('@/styles/fonts', () => ({
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

const popupContainer = () => document.querySelector<HTMLElement>('#popup-container')!;

let cell: HTMLElement;
let anchor: HTMLElement;

/** Drive a link click in the book through to a rendered, document-backed popup. */
const openLinkedFootnote = () => {
  const href = 'text/part0012.xhtml#appendix-c';
  const view = document.createElement('div');
  Object.defineProperty(view, 'renderer', {
    value: { viewSize: 220, setAttribute: () => {}, setStyles: () => {} },
  });
  act(() => {
    h.onLinkClick.current?.(
      new CustomEvent('link', { detail: { a: anchor, href }, cancelable: true }),
    );
  });
  const handler = h.handlers.at(-1)!;
  act(() => {
    handler.dispatchEvent(new CustomEvent('before-render', { detail: { view } }));
    handler.dispatchEvent(
      new CustomEvent('render', { detail: { view, href, index: 3, extract: null } }),
    );
    view.dispatchEvent(new CustomEvent('relocate', { detail: {} }));
  });
};

beforeEach(() => {
  h.viewSettings = { vertical: false, rtl: false, scrolled: false };
  h.handlers.length = 0;
  h.onLinkClick.current = null;
  // The book cell fills the test frame, with the note reference near its
  // top-left corner so a popup has room to open on either axis.
  cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  cell.style.cssText = 'position:fixed;inset:0;';
  anchor = document.createElement('a');
  anchor.textContent = 'nota 3';
  anchor.style.cssText = 'position:absolute;left:40px;top:120px;';
  cell.appendChild(anchor);
  document.body.appendChild(cell);
});

afterEach(() => {
  cell.remove();
  cleanup();
});

describe('footnote popup box (#5999)', () => {
  test('a short note leaves the popup with no scrollbars of its own', () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    act(() => {
      h.dispatchFootnote({
        bookKey: 'book-1',
        element: anchor,
        footnote: 'nota 3 - Orme di Dante in Italia, tradotto da Egidio Gorra.',
      });
    });

    const popup = popupContainer();
    expect(popup.getAttribute('aria-hidden')).toBe('false');
    expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth);
    expect(popup.scrollHeight).toBeLessThanOrEqual(popup.clientHeight);
  });

  test('a vertical-layout note leaves the popup with no scrollbars of its own', () => {
    h.viewSettings = { vertical: true, rtl: false, scrolled: false };
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    act(() => {
      h.dispatchFootnote({
        bookKey: 'book-1',
        element: anchor,
        footnote: 'nota 3 - Orme di Dante in Italia, tradotto da Egidio Gorra.',
      });
    });

    const popup = popupContainer();
    expect(popup.getAttribute('aria-hidden')).toBe('false');
    expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth);
    expect(popup.scrollHeight).toBeLessThanOrEqual(popup.clientHeight);
  });

  // Sizing the popup box to the measured content size left the document itself
  // 2px short of what it asked for, so the scrollbar simply moved one level in:
  // foliate's own scroll container grew one. The box has to be the measurement
  // plus the border it is drawn with.
  test('gives the popup document the full size it measured', () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    openLinkedFootnote(); // the stub renderer reports a viewSize of 220

    const content = document.querySelector<HTMLElement>('.footnote-content')!;
    expect(content.clientHeight).toBe(220);
  });

  // At most one scrollbar, ever: a note too long for the box scrolls along its
  // block axis, and the other axis stays clipped rather than being promoted
  // from `visible` to `auto` behind the block-axis scroll.
  test('a note too long for the box scrolls on one axis only', () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    act(() => {
      h.dispatchFootnote({
        bookKey: 'book-1',
        element: anchor,
        footnote: 'Questa nota e volutamente lunga. '.repeat(120),
      });
    });

    const popup = popupContainer();
    expect(popup.getAttribute('aria-hidden')).toBe('false');
    expect(popup.scrollHeight).toBeGreaterThan(popup.clientHeight);
    expect(popup.scrollWidth).toBeLessThanOrEqual(popup.clientWidth);
    expect(getComputedStyle(popup).overflowX).toBe('hidden');
  });
});

// Anchored at the top of the box, the button sat squarely on the note's first
// line. The last line is where a paragraph runs ragged, so the bottom corner
// on the side the text ends on is the one that hides the least (#5998).
describe('jump-to-location button placement (#5998)', () => {
  const jumpButton = () => document.querySelector<HTMLElement>('[aria-label="Jump to Location"]')!;

  const cornerOfPopup = () => {
    const popup = popupContainer().getBoundingClientRect();
    const button = jumpButton().getBoundingClientRect();
    const center = { x: (button.left + button.right) / 2, y: (button.top + button.bottom) / 2 };
    return {
      vertical: center.y > (popup.top + popup.bottom) / 2 ? 'bottom' : 'top',
      horizontal: center.x > (popup.left + popup.right) / 2 ? 'right' : 'left',
    };
  };

  test('sits in the bottom-right corner for a left-to-right book', () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    openLinkedFootnote();

    expect(cornerOfPopup()).toEqual({ vertical: 'bottom', horizontal: 'right' });
  });

  test('sits in the bottom-left corner for a right-to-left book', () => {
    h.viewSettings = { vertical: false, rtl: true, scrolled: false };
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    openLinkedFootnote();

    expect(cornerOfPopup()).toEqual({ vertical: 'bottom', horizontal: 'left' });
  });

  test('sits in the bottom-left corner for a vertical-layout book', () => {
    h.viewSettings = { vertical: true, rtl: false, scrolled: false };
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    openLinkedFootnote();

    expect(cornerOfPopup()).toEqual({ vertical: 'bottom', horizontal: 'left' });
  });
});
