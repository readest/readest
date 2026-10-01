/**
 * Where a footnote popup lands on a phone with a top safe-area inset, measured
 * with real geometry (#6307).
 *
 * `getPosition`/`getPopupPosition` return points relative to the rect they are
 * given, while the popup renders relative to the book cell. Clamping to an
 * inset rect without shifting the result back moved every popup up by the top
 * inset on an ordinary iPhone (59px), onto the selected word. Only iPhone Duo
 * clamps to the safe region; everything else uses the raw cell rect.
 *
 * Driving the real Annotator needs a live foliate view and iframe selection,
 * so this exercises the same positioning path through FootnotePopup: the
 * production Popup, `getPosition`, `getPopupPosition` and the inset helpers,
 * against a real 393x852 cell.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { page } from 'vitest/browser';

import '@/styles/globals.css';

const h = vi.hoisted(() => ({
  isIPhoneDuo: false,
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
  useThemeStore: { getState: () => ({ isDarkMode: false, isIPhoneDuo: h.isIPhoneDuo }) },
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
import { getPopupBounds } from '@/utils/insets';
import { getPosition } from '@/utils/sel';
import type { BookDoc } from '@/libs/document';
import type { Insets } from '@/types/misc';

const NOTE = 'A short note that the popup shows for the tapped footnote marker.';
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const PHONE_TOP: Insets = { top: 59, right: 0, bottom: 34, left: 0 };

let cell: HTMLElement;
let host: HTMLElement;
let anchor: HTMLElement;

beforeEach(async () => {
  await page.viewport(393, 852);
  h.isIPhoneDuo = false;
  h.handlers.length = 0;
  // The book cell: origin at the viewport's, the insets lie inside it.
  cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  cell.style.cssText = 'position:fixed;inset:0;';
  anchor = document.createElement('a');
  anchor.textContent = 'note 3';
  anchor.style.cssText = 'position:absolute;left:150px;top:300px;font-size:16px;';
  host = document.createElement('div');
  cell.append(anchor, host);
  document.body.appendChild(cell);
});

afterEach(() => {
  cleanup();
  cell.remove();
});

/** Open the popup on the anchor and measure the triangle and popup boxes. */
const openPopup = (gridInsets: Insets) => {
  render(<FootnotePopup bookKey='book-1' bookDoc={{} as BookDoc} gridInsets={gridInsets} />, {
    container: host,
  });
  act(() => {
    h.dispatchFootnote({ bookKey: 'book-1', element: anchor, footnote: NOTE });
  });
  const triangle = host
    .querySelector<HTMLElement>('.popup-triangle-outer')!
    .getBoundingClientRect();
  const popup = host.querySelector<HTMLElement>('#popup-container')!.getBoundingClientRect();
  const text = anchor.getBoundingClientRect();
  const dir = triangle.top < text.top ? 'up' : 'down';
  // A 14x7 triangle: the apex is the edge that faces the text.
  const tip = {
    x: triangle.left + triangle.width / 2,
    y: dir === 'down' ? triangle.top : triangle.bottom,
  };
  return { triangle, popup, text, tip, dir };
};

const expectPointerOnText = ({ tip, text, popup, dir }: ReturnType<typeof openPopup>) => {
  expect(tip.x).toBeGreaterThanOrEqual(text.left);
  expect(tip.x).toBeLessThanOrEqual(text.right);
  // The pointer sits within a line's height of the word, on the side that the
  // popup opens from, and the popup itself never covers the word.
  const gap = dir === 'down' ? tip.y - text.bottom : text.top - tip.y;
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(14);
  const overlapsText =
    popup.left < text.right &&
    popup.right > text.left &&
    popup.top < text.bottom &&
    popup.bottom > text.top;
  expect(overlapsText).toBe(false);
};

const box = (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });

describe('popup placement with a 59px top safe-area inset (393x852)', () => {
  test('off the Duo the pointer lands on the selected text', () => {
    expectPointerOnText(openPopup(PHONE_TOP));
  });

  test('on the Duo the pointer lands on the selected text', () => {
    h.isIPhoneDuo = true;
    expectPointerOnText(openPopup(PHONE_TOP));
  });

  test('off the Duo the placement equals the no-inset computation', () => {
    const inset = openPopup(PHONE_TOP);
    cleanup();
    const none = openPopup(NO_INSETS);
    expect(box(inset.triangle)).toEqual(box(none.triangle));
    expect(box(inset.popup)).toEqual(box(none.popup));
  });

  test('on the Duo, a target well inside the safe area is placed as with no inset', () => {
    h.isIPhoneDuo = true;
    const duo = openPopup(PHONE_TOP);
    cleanup();
    h.isIPhoneDuo = false;
    const none = openPopup(NO_INSETS);
    expect(box(duo.triangle)).toEqual(box(none.triangle));
    expect(box(duo.popup)).toEqual(box(none.popup));
  });

  test('control: positions from an inset rect are not cell coordinates until shifted back', () => {
    // The bug this file guards against: the inset rect's result lands `top`
    // px above where the cell-relative result does.
    const { rect } = getPopupBounds(cell.getBoundingClientRect(), PHONE_TOP, true);
    const raw = getPosition(anchor, cell.getBoundingClientRect(), 10);
    const unshifted = getPosition(anchor, rect, 10);
    expect(raw.point.y - unshifted.point.y).toBe(PHONE_TOP.top);
  });
});
