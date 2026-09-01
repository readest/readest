import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

// A popup built from a data/alt attribute measures its text synchronously and
// sizes the box to the result. It used to be pinned at the seed height on every
// open, because the size effect keyed on the trigger position ran after the
// commit and threw that measurement away.

const PARAGRAPH_HEIGHT = 152;
// The popup box carries a 1px border on each side, and the paragraph is
// measured for the room inside it, so the box is that much taller (#5999).
const POPUP_HEIGHT = PARAGRAPH_HEIGHT + 2;

const h = vi.hoisted(() => ({
  viewSettings: { vertical: false, scrolled: false },
  dispatchFootnote: (() => {}) as (detail: unknown) => void,
  handlerListeners: new Map<string, ((e: Event) => void)[]>(),
  resizeObservers: [] as ((entries: unknown[]) => void)[],
  frames: [] as ((() => void) | null)[],
  emitHandler: (name: string, detail: unknown) => {
    for (const cb of h.handlerListeners.get(name) ?? []) {
      cb(new CustomEvent(name, { detail }));
    }
  },
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
// The popup's stylesheet is beside the point here; these tests are about the box.
vi.mock('@/utils/style', () => ({
  getStyles: () => '',
  getFootnoteStyles: () => '',
  getThemeCode: () => ({ bg: '#fff', fg: '#000' }),
}));
vi.mock('@/styles/fonts', () => ({
  mountAdditionalFonts: () => {},
  mountCustomFont: () => {},
}));
vi.mock('foliate-js/footnotes.js', () => ({
  FootnoteHandler: class {
    addEventListener(name: string, cb: (e: Event) => void) {
      h.handlerListeners.set(name, [...(h.handlerListeners.get(name) ?? []), cb]);
    }
    removeEventListener(name: string, cb: (e: Event) => void) {
      h.handlerListeners.set(
        name,
        (h.handlerListeners.get(name) ?? []).filter((l) => l !== cb),
      );
    }
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

const popupContainer = () => document.querySelector<HTMLElement>('#popup-container');

// Just enough of a foliate view for the popup's before-render/render wiring.
const makePopupView = (viewSize = 240) => {
  const view = document.createElement('div');
  Object.assign(view, {
    renderer: { setAttribute: () => {}, setStyles: () => {}, viewSize },
    getCFI: () => '',
    close: () => {},
  });
  return view as HTMLDivElement & { renderer: { viewSize: number } };
};

const flushFrames = () => {
  const pending = h.frames.slice();
  h.frames.length = 0;
  pending.forEach((cb) => cb?.());
};

beforeEach(() => {
  h.handlerListeners.clear();
  h.resizeObservers.length = 0;
  h.frames.length = 0;
  // jsdom has no ResizeObserver, and Popup keeps one on its container.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(cb: (entries: unknown[]) => void) {
        h.resizeObservers.push(cb);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => h.frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    h.frames[id - 1] = null;
  });
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

    expect(popupContainer()?.style.height).toBe(`${POPUP_HEIGHT}px`);
  });
});

// A footnote whose visible content is elements only — an image, a bare figure —
// makes foliate's visible range collapse, so the paginator never dispatches
// `relocate`. Gating the popup's visibility on that event alone left such a
// popup loaded, sized, and parked off-screen forever (#5887).
describe('footnote popup whose section never emits relocate', () => {
  test('shows once the content has been measured', () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);

    const popupView = makePopupView();
    act(() => {
      h.emitHandler('before-render', { view: popupView });
      h.emitHandler('render', { view: popupView, href: 'notes.xhtml#n1', index: 1, extract: null });
    });
    expect(popupContainer()?.getAttribute('aria-hidden')).toBe('true');

    act(() => {
      popupView.dispatchEvent(new CustomEvent('load', { detail: { doc: document, index: 1 } }));
      // The content observer reports the first measurement; no `relocate` ever
      // arrives, exactly as for an image-only footnote.
      h.resizeObservers.forEach((cb) => cb([]));
      flushFrames();
    });

    expect(popupContainer()?.getAttribute('aria-hidden')).toBe('false');
  });
});
