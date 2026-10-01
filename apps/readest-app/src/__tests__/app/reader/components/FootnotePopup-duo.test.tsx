/**
 * Footnote popup placement against the cell's safe area, which only iPhone Duo
 * uses (#6307). Points stay relative to the cell's origin, because that is
 * what the popup renders against; every other device gets the raw cell rect.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { BookDoc } from '@/libs/document';
import type { Insets } from '@/types/misc';
import type { Position } from '@/utils/sel';

const BOOK_KEY = 'bookid-0';
const CELL = { width: 951, height: 669 };

const hoisted = vi.hoisted(() => ({
  isIPhoneDuo: false,
  handlers: [] as EventTarget[],
  onLinkClick: { current: null as ((event: Event) => void) | null },
  positionRects: [] as { left: number; top: number; right: number; bottom: number }[],
  popupRects: [] as { left: number; top: number; right: number; bottom: number }[],
  popupProps: { current: {} as { position?: Position; trianglePosition?: Position } },
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

// Like the real hook, which binds once per view: keep the first render's handler.
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
  getBookData: () => ({ book: { primaryLanguage: 'en' } }),
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
    getViewSettings: () => ({ vertical: false }),
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: {
    getState: () => ({ isDarkMode: false, isIPhoneDuo: hoisted.isIPhoneDuo }),
  },
}));
vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [] }),
}));
vi.mock('@/utils/style', () => ({
  getFootnoteStyles: () => '',
  getStyles: () => '',
  getThemeCode: () => ({ bg: '#fff', fg: '#000', primary: '#000', palette: {} }),
}));
vi.mock('@/styles/fonts', () => ({ mountAdditionalFonts: vi.fn(), mountCustomFont: vi.fn() }));
vi.mock('@/utils/sel', () => ({
  getPosition: (_target: unknown, rect: (typeof hoisted.positionRects)[number]) => {
    hoisted.positionRects.push(rect);
    return { point: { x: 100, y: 100 }, dir: 'down' };
  },
  getPopupPosition: (_p: unknown, rect: (typeof hoisted.popupRects)[number]) => {
    hoisted.popupRects.push(rect);
    return { point: { x: 10, y: 10 }, dir: 'down' };
  },
}));
vi.mock('@/app/reader/utils/transientHighlight', () => ({ showTransientHighlight: vi.fn() }));
vi.mock('@/app/reader/utils/annotatorUtil', () => ({ drawAnnotationOverlay: vi.fn() }));
vi.mock('@/app/reader/utils/footnoteHeuristics', () => ({
  shouldCheckAsFootnote: () => false,
  isLinkTargetVisible: () => true,
}));
vi.mock('@/components/Overlay', () => ({ Overlay: () => <div /> }));
vi.mock('@/components/Popup', () => ({
  default: (props: { children: ReactNode; position?: Position; trianglePosition?: Position }) => {
    hoisted.popupProps.current = props;
    return <div>{props.children}</div>;
  },
}));

const renderPopup = async (gridInsets?: Insets) => {
  const grid = document.createElement('div');
  grid.id = `gridcell-${BOOK_KEY}`;
  grid.getBoundingClientRect = () => new DOMRect(0, 0, CELL.width, CELL.height);
  document.body.appendChild(grid);
  const { default: FootnotePopup } = await import('@/app/reader/components/FootnotePopup');
  return {
    ...render(<FootnotePopup bookKey={BOOK_KEY} bookDoc={{} as BookDoc} gridInsets={gridInsets} />),
    FootnotePopup,
  };
};

/** Drive a link click through to a rendered footnote popup. */
const tapFootnoteLink = async () => {
  const href = 'x#y';
  const anchor = document.createElement('a');
  document.body.appendChild(anchor);
  await act(async () => {
    hoisted.onLinkClick.current?.(
      new CustomEvent('link', { detail: { a: anchor, href }, cancelable: true }),
    );
  });
  const view = document.createElement('div');
  const renderer = document.createElement('div') as HTMLDivElement & {
    viewSize: number;
    setStyles: () => void;
  };
  renderer.viewSize = 240;
  renderer.setStyles = vi.fn();
  Object.defineProperty(view, 'renderer', { value: renderer });
  const handler = hoisted.handlers.at(-1)!;
  await act(async () => {
    handler.dispatchEvent(new CustomEvent('before-render', { detail: { view } }));
    handler.dispatchEvent(
      new CustomEvent('render', { detail: { view, href, index: 3, extract: null } }),
    );
    view.dispatchEvent(new CustomEvent('relocate', { detail: {} }));
  });
};

beforeEach(() => {
  document.body.replaceChildren();
  hoisted.isIPhoneDuo = false;
  hoisted.handlers.length = 0;
  hoisted.onLinkClick.current = null;
  hoisted.positionRects.length = 0;
  hoisted.popupRects.length = 0;
});

describe('FootnotePopup safe-area clamp', () => {
  it('off the Duo positions against the raw cell rect, whatever the insets', async () => {
    await renderPopup({ top: 59, right: 0, bottom: 34, left: 0 });
    await tapFootnoteLink();
    expect(hoisted.positionRects.at(-1)).toMatchObject({
      left: 0,
      top: 0,
      right: CELL.width,
      bottom: CELL.height,
    });
    expect(hoisted.popupProps.current.trianglePosition?.point).toEqual({ x: 100, y: 100 });
    expect(hoisted.popupProps.current.position?.point).toEqual({ x: 10, y: 10 });
  });

  it('on the Duo clamps to the inset rect and translates back to cell coordinates', async () => {
    hoisted.isIPhoneDuo = true;
    await renderPopup({ top: 59, right: 0, bottom: 34, left: 84 });
    await tapFootnoteLink();
    expect(hoisted.positionRects.at(-1)).toMatchObject({
      left: 84,
      top: 59,
      right: CELL.width,
      bottom: CELL.height - 34,
    });
    expect(hoisted.popupProps.current.trianglePosition?.point).toEqual({ x: 184, y: 159 });
    expect(hoisted.popupProps.current.position?.point).toEqual({ x: 94, y: 69 });
  });

  it('on the Duo clamps to the insets current at the tap, not those from when the view opened', async () => {
    // The side strip moves to the other edge on rotation; the link handler is
    // bound once per view, so it must read the insets fresh.
    hoisted.isIPhoneDuo = true;
    const { rerender, FootnotePopup } = await renderPopup({
      top: 0,
      right: 84,
      bottom: 0,
      left: 0,
    });
    rerender(
      <FootnotePopup
        bookKey={BOOK_KEY}
        bookDoc={{} as BookDoc}
        gridInsets={{ top: 0, right: 0, bottom: 0, left: 84 }}
      />,
    );
    await tapFootnoteLink();
    expect(hoisted.positionRects.at(-1)).toMatchObject({ left: 84, right: CELL.width });
  });
});
