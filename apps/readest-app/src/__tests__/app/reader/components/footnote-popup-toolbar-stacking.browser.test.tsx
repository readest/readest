/**
 * Stacking order of the selection toolbar over the footnote popup (#6145).
 *
 * Text inside the footnote popup is selectable, so the selection toolbar opens
 * against a selection that lives *in* the popup — the toolbar and its lookup
 * buttons must own those pixels, exactly like they do over the book page.
 *
 * BooksGrid already renders FootnotePopup before Annotator so DOM order put
 * the toolbar on top while both surfaces sat at z-50. #6036 moved the toolbar
 * into its own `z-[43]` band (below the range handles) and the tie stopped
 * being broken by DOM order: the footnote popup's z-50 buried the toolbar, and
 * the dictionary button under it could not be seen or tapped.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import '@/styles/globals.css';

const h = vi.hoisted(() => ({
  viewSettings: { vertical: false, rtl: false, scrolled: false },
  dispatchFootnote: (() => {}) as (detail: unknown) => void,
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
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({ useFoliateEvents: () => {} }));
vi.mock('@/app/reader/utils/footnoteHeuristics', () => ({
  shouldCheckAsFootnote: () => false,
  isLinkTargetVisible: () => true,
}));
vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  drawAnnotationOverlay: () => {},
  getHighlightColorLabel: (color: string) => color,
}));
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
import AnnotationPopup from '@/app/reader/components/annotator/AnnotationPopup';
import { BookDoc } from '@/libs/document';

const NOTE =
  'nota 3 - Orme di Dante in Italia, tradotto da Egidio Gorra, con una lunga ' +
  'appendice sulle fonti manoscritte e sulle varianti raccolte dal curatore.';

/** The band a surface actually sits in: the nearest ancestor that sets one. */
const layerOf = (el: Element | null) => {
  for (let node = el?.parentElement; node; node = node.parentElement) {
    const z = getComputedStyle(node).zIndex;
    if (z !== 'auto') return Number(z);
  }
  return null;
};

let cell: HTMLElement;
let anchor: HTMLElement;

beforeEach(() => {
  h.viewSettings = { vertical: false, rtl: false, scrolled: false };
  h.handlers.length = 0;
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

/** The footnote popup's own container, never the toolbar's. */
const footnoteContainer = () =>
  document.querySelector<HTMLElement>('#popup-container:not(.selection-popup)')!;

/** Open the toolbar on a selection inside the already-open footnote popup. */
const openToolbarOver = (rect: DOMRect) => {
  const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  render(
    <AnnotationPopup
      bookKey='book-1'
      dir='ltr'
      isVertical={false}
      buttons={[
        {
          tooltipText: 'Dictionary',
          Icon: () => <span>D</span>,
          onClick: () => {},
        },
      ]}
      notes={[]}
      position={{ point }}
      trianglePosition={{ point, dir: 'up' }}
      highlightOptionsVisible={false}
      selectedStyle='highlight'
      selectedColor='yellow'
      popupWidth={240}
      popupHeight={44}
      onHighlight={() => {}}
      onDismiss={() => {}}
    />,
  );
  return document.querySelector<HTMLElement>('.selection-popup')!;
};

describe('selection toolbar over the footnote popup (#6145)', () => {
  test('the toolbar owns the pixels it overlaps in the footnote popup', () => {
    // Mounted in BooksGrid's order: the footnote popup first, the annotator's
    // toolbar after it.
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    act(() => {
      h.dispatchFootnote({ bookKey: 'book-1', element: anchor, footnote: NOTE });
    });

    const footnote = footnoteContainer();
    expect(footnote.getAttribute('aria-hidden')).toBe('false');

    const toolbar = openToolbarOver(footnote.getBoundingClientRect());

    // Premise: the two boxes really do overlap, so the hit test below means
    // something.
    const noteBox = footnote.getBoundingClientRect();
    const toolBox = toolbar.getBoundingClientRect();
    const overlap = {
      left: Math.max(noteBox.left, toolBox.left),
      top: Math.max(noteBox.top, toolBox.top),
      right: Math.min(noteBox.right, toolBox.right),
      bottom: Math.min(noteBox.bottom, toolBox.bottom),
    };
    expect(overlap.right).toBeGreaterThan(overlap.left);
    expect(overlap.bottom).toBeGreaterThan(overlap.top);

    const hit = document.elementFromPoint(
      (overlap.left + overlap.right) / 2,
      (overlap.top + overlap.bottom) / 2,
    );
    expect(toolbar.contains(hit)).toBe(true);
  });

  test('the footnote popup sits below the selection toolbar band', () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} />);
    act(() => {
      h.dispatchFootnote({ bookKey: 'book-1', element: anchor, footnote: NOTE });
    });

    const footnote = footnoteContainer();
    const toolbar = openToolbarOver(footnote.getBoundingClientRect());

    const footnoteLayer = layerOf(footnote);
    const toolbarLayer = layerOf(toolbar);
    expect(footnoteLayer).not.toBeNull();
    expect(toolbarLayer).not.toBeNull();
    expect(footnoteLayer!).toBeLessThan(toolbarLayer!);
  });
});
