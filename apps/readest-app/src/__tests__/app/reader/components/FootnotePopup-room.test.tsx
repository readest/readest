/**
 * The room a footnote popup sizes itself to is measured in the book cell, the
 * frame its anchor point is in. Measured against the window, a pinned sidebar
 * or a second book beside the cell counted as room, so a long note came out
 * wider than the space beside its noteref and the clamp slid it back over
 * the noteref (#7637).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { BookDoc } from '@/libs/document';
import type { Position } from '@/utils/sel';

const BOOK_KEY = 'bookid-0';
const PADDING = 10;

const hoisted = vi.hoisted(() => ({
  vertical: false,
  anchor: null as Position | null,
  handlers: [] as EventTarget[],
  onLinkClick: { current: null as ((event: Event) => void) | null },
  popupProps: {
    current: {} as { width?: number; position?: Position; trianglePosition?: Position },
  },
}));

vi.mock('foliate-js/footnotes.js', () => {
  class FootnoteHandler extends EventTarget {
    handle = vi.fn(() => Promise.resolve());
    constructor() {
      super();
      hoisted.handlers.push(this);
    }
  }
  return { FootnoteHandler };
});
vi.mock('@/app/reader/hooks/useFoliateEvents', () => ({
  useFoliateEvents: (_view: unknown, handlers?: { onLinkClick?: (event: Event) => void }) => {
    hoisted.onLinkClick.current ??= handlers?.onLinkClick ?? null;
  },
}));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (size: number) => size }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobile: false } }),
}));
const bookDataState = {
  booksData: { bookid: { config: { booknotes: [] } } },
  getBookData: () => ({ book: { primaryLanguage: 'zh' } }),
};
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: Object.assign(
    (selector?: (state: typeof bookDataState) => unknown) =>
      selector ? selector(bookDataState) : bookDataState,
    { getState: () => bookDataState },
  ),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ goTo: vi.fn() }),
    getViewSettings: () => ({ vertical: hoisted.vertical }),
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: { getState: () => ({ isDarkMode: false, isIPhoneDuo: false }) },
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [] }),
}));
vi.mock('@/utils/style', () => ({
  applyLinkHitArea: () => {},
  keepTextAlignment: () => {},
  getFootnoteStyles: () => '',
  getStyles: () => '',
  getThemeCode: () => ({ bg: '#fff', fg: '#000', primary: '#000', palette: {} }),
}));
vi.mock('@/styles/fonts', () => ({ mountAdditionalFonts: vi.fn(), mountCustomFont: vi.fn() }));
// jsdom lays nothing out, so the anchor comes from the test; the popup is
// placed by the real getPopupPosition.
vi.mock('@/utils/sel', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/sel')>()),
  getPosition: () => hoisted.anchor,
}));
vi.mock('@/app/reader/utils/transientHighlight', () => ({ showTransientHighlight: vi.fn() }));
vi.mock('@/app/reader/utils/annotatorUtil', () => ({ drawAnnotationOverlay: vi.fn() }));
vi.mock('@/app/reader/utils/footnoteHeuristics', () => ({
  shouldCheckAsFootnote: () => false,
  linksToDeclaredNote: () => false,
  isLinkTargetVisible: () => true,
}));
vi.mock('@/components/Overlay', () => ({ Overlay: () => <div /> }));
vi.mock('@/components/Popup', () => ({
  default: (props: {
    children: ReactNode;
    width?: number;
    position?: Position;
    trianglePosition?: Position;
  }) => {
    hoisted.popupProps.current = props;
    return <div>{props.children}</div>;
  },
}));

const setWindowSize = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: height, configurable: true });
};

/** Open the popup for a note whose content is `noteSize` along the reading axis. */
const openNote = async (cell: DOMRect, noteSize: number) => {
  const grid = document.createElement('div');
  grid.id = `gridcell-${BOOK_KEY}`;
  grid.getBoundingClientRect = () => cell;
  document.body.appendChild(grid);
  const { default: FootnotePopup } = await import('@/app/reader/components/FootnotePopup');
  render(<FootnotePopup bookKey={BOOK_KEY} bookDoc={{} as BookDoc} />);

  const href = 'chapter1.xhtml#note1';
  const link = document.createElement('a');
  document.body.appendChild(link);
  await act(async () => {
    hoisted.onLinkClick.current?.(
      new CustomEvent('link', { detail: { a: link, href }, cancelable: true }),
    );
  });
  const view = document.createElement('div');
  const renderer = document.createElement('div') as HTMLDivElement & {
    viewSize: number;
    setStyles: () => void;
  };
  renderer.viewSize = noteSize;
  renderer.setStyles = vi.fn();
  Object.defineProperty(view, 'renderer', { value: renderer });
  const handler = hoisted.handlers.at(-1)!;
  await act(async () => {
    handler.dispatchEvent(new CustomEvent('before-render', { detail: { view } }));
    handler.dispatchEvent(
      new CustomEvent('render', { detail: { view, href, index: 1, extract: null } }),
    );
    view.dispatchEvent(new CustomEvent('relocate', { detail: {} }));
  });
  const { width, position, trianglePosition } = hoisted.popupProps.current;
  return { width: width!, point: position!.point, anchor: trianglePosition!.point };
};

const { innerWidth, innerHeight } = window;

beforeEach(() => {
  document.body.replaceChildren();
  hoisted.handlers.length = 0;
  hoisted.onLinkClick.current = null;
  hoisted.popupProps.current = {};
});

afterEach(() => setWindowSize(innerWidth, innerHeight));

describe('FootnotePopup room beside the noteref (#7637)', () => {
  it('in a vertical book, opens beside a noteref in a cell right of a pinned sidebar', async () => {
    // The issue's layout: a 1920px window, the TOC sidebar pinned on the left,
    // the noteref mid-page with more room to its right, and a long note.
    hoisted.vertical = true;
    hoisted.anchor = { point: { x: 548, y: 851 }, dir: 'right' };
    setWindowSize(1920, 988);
    const cell = new DOMRect(288, 0, 1632, 988);

    const { width, point, anchor } = await openNote(cell, 1480);

    // The box starts right of the noteref, with no overlap, and still fits
    // in the cell.
    expect(point.x).toBeGreaterThanOrEqual(anchor.x);
    expect(point.x + width).toBeLessThanOrEqual(cell.width - PADDING);
  });

  it('in a horizontal book, keeps the popup inside a cell narrower than the window', async () => {
    hoisted.vertical = false;
    hoisted.anchor = { point: { x: 300, y: 100 }, dir: 'down' };
    setWindowSize(900, 988);
    const cell = new DOMRect(288, 0, 612, 988);

    const { width, point } = await openNote(cell, 4000);

    expect(point.x).toBeGreaterThanOrEqual(PADDING);
    expect(point.x + width).toBeLessThanOrEqual(cell.width - PADDING);
  });
});
