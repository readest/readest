/**
 * Footnote popup "Jump to Location" (#5766).
 *
 * A link pointing at an appendix or a long section only ever renders as its
 * heading in the popup (foliate's #showFragment falls through to
 * `range.selectNode(el)`), so a popup backed by a book document must offer a
 * way out to the real page. Popups synthesized from a `data-*` attribute have
 * no location in the book and must not offer one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { BookDoc } from '@/libs/document';
import { eventDispatcher } from '@/utils/event';

const BOOK_KEY = 'bookid-0';
const HREF = 'text/part0012.xhtml#appendix-c';

const hoisted = vi.hoisted(() => ({
  handlers: [] as EventTarget[],
  onLinkClick: { current: null as ((event: Event) => void) | null },
  goTo: vi.fn(),
  showTransientHighlight: vi.fn(),
  isLinkTargetVisible: vi.fn(),
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
    hoisted.onLinkClick.current = handlers?.onLinkClick ?? null;
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

vi.mock('@/hooks/useResponsiveSize', () => ({
  useResponsiveSize: (size: number) => size,
}));

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
    getView: () => ({ goTo: hoisted.goTo }),
    getViewSettings: () => ({ vertical: false }),
  }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: {} }) },
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: { getState: () => ({ isDarkMode: false }) },
}));

vi.mock('@/store/customFontStore', () => ({
  useCustomFontStore: () => ({ getLoadedFonts: () => [] }),
}));

vi.mock('@/utils/style', () => ({
  getFootnoteStyles: () => '',
  getStyles: () => '',
  getThemeCode: () => ({ bg: '#fff', fg: '#000', primary: '#000', palette: {} }),
}));

vi.mock('@/styles/fonts', () => ({
  mountAdditionalFonts: vi.fn(),
  mountCustomFont: vi.fn(),
}));

vi.mock('@/utils/sel', () => ({
  getPosition: () => ({ point: { x: 10, y: 10 }, dir: 'down' }),
  getPopupPosition: () => ({ point: { x: 10, y: 10 }, dir: 'down' }),
}));

vi.mock('@/app/reader/utils/transientHighlight', () => ({
  showTransientHighlight: hoisted.showTransientHighlight,
}));

vi.mock('@/app/reader/utils/annotatorUtil', () => ({
  drawAnnotationOverlay: vi.fn(),
}));

vi.mock('@/app/reader/utils/footnoteHeuristics', () => ({
  shouldCheckAsFootnote: () => false,
  isLinkTargetVisible: hoisted.isLinkTargetVisible,
}));

vi.mock('@/components/Overlay', () => ({
  Overlay: () => <div data-testid='overlay' />,
}));

// The real Popup keeps its children mounted and only moves them off-screen
// when closed, which FootnotePopup relies on to fill `footnoteRef` ahead of
// the first render.
vi.mock('@/components/Popup', () => ({
  default: ({ isOpen, children }: { isOpen?: boolean; children: ReactNode }) => (
    <div data-testid='popup' data-open={isOpen ? 'true' : 'false'}>
      {children}
    </div>
  ),
}));

const createPopupView = () => {
  const view = document.createElement('div');
  const renderer = document.createElement('div') as HTMLDivElement & {
    viewSize: number;
    setStyles: () => void;
  };
  renderer.viewSize = 240;
  renderer.setStyles = vi.fn();
  Object.defineProperty(view, 'renderer', { value: renderer });
  return view;
};

const renderPopup = async () => {
  const grid = document.createElement('div');
  grid.id = `gridcell-${BOOK_KEY}`;
  document.body.appendChild(grid);
  const { default: FootnotePopup } = await import('@/app/reader/components/FootnotePopup');
  return render(<FootnotePopup bookKey={BOOK_KEY} bookDoc={{} as BookDoc} />);
};

const stylesOf = (view: HTMLElement) => {
  const setStyles = (view as unknown as { renderer: { setStyles: ReturnType<typeof vi.fn> } })
    .renderer.setStyles;
  return setStyles.mock.calls.at(-1)?.[0] as string | undefined;
};

/** Drive a link click in the book through to a rendered footnote popup. */
const openFootnotePopup = async (href = HREF) => {
  const anchor = document.createElement('a');
  anchor.setAttribute('href', href);
  document.body.appendChild(anchor);
  await act(async () => {
    hoisted.onLinkClick.current?.(
      new CustomEvent('link', { detail: { a: anchor, href }, cancelable: true }),
    );
  });
  const handler = hoisted.handlers.at(-1)!;
  const view = createPopupView();
  await act(async () => {
    handler.dispatchEvent(new CustomEvent('before-render', { detail: { view } }));
    handler.dispatchEvent(
      new CustomEvent('render', { detail: { view, href, index: 3, extract: null } }),
    );
    view.dispatchEvent(new CustomEvent('relocate', { detail: {} }));
  });
  return view;
};

describe('FootnotePopup jump to location', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    hoisted.handlers.length = 0;
    hoisted.onLinkClick.current = null;
    hoisted.goTo.mockReset();
    hoisted.showTransientHighlight.mockReset().mockResolvedValue(null);
    hoisted.isLinkTargetVisible.mockReset().mockReturnValue(true);
  });

  it('navigates the book view to the popup source and dismisses the popup', async () => {
    await renderPopup();
    await openFootnotePopup();

    const button = screen.getByLabelText('Jump to Location');
    await act(async () => {
      fireEvent.click(button);
    });

    expect(hoisted.goTo).toHaveBeenCalledWith(HREF);
    expect(screen.getByTestId('popup').dataset['open']).toBe('false');
    expect(screen.queryByLabelText('Jump to Location')).toBeNull();
  });

  it('jumps to the nested target after following a link inside the popup', async () => {
    await renderPopup();
    await openFootnotePopup();

    const nestedHref = 'text/part0003.xhtml#note-12';
    const handler = hoisted.handlers.at(-1)!;
    const view = createPopupView();
    await act(async () => {
      handler.dispatchEvent(new CustomEvent('before-render', { detail: { view } }));
      handler.dispatchEvent(
        new CustomEvent('render', {
          detail: { view, href: nestedHref, index: 1, extract: null },
        }),
      );
      view.dispatchEvent(new CustomEvent('relocate', { detail: {} }));
    });

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Jump to Location'));
    });

    expect(hoisted.goTo).toHaveBeenCalledWith(nestedHref);
  });

  // The reader's stylesheet hides inline footnote bodies, so a link that
  // points at one has nowhere to take the reader (#5766 follow-up).
  it('offers no jump when the link target is hidden in the book', async () => {
    hoisted.isLinkTargetVisible.mockReturnValue(false);
    await renderPopup();
    await openFootnotePopup('ch1.xhtml#B_1');

    expect(screen.getByTestId('popup').dataset['open']).toBe('true');
    expect(screen.queryByLabelText('Jump to Location')).toBeNull();
  });

  // The chrome floats over the popup document rather than pushing it down:
  // reserving a strip left a band of dead space above every short footnote.
  it('reserves no room in the popup document for the chrome', async () => {
    await renderPopup();
    const view = await openFootnotePopup();
    expect(screen.getByLabelText('Jump to Location')).toBeTruthy();
    expect(stylesOf(view)).not.toContain('padding-block-start');
  });

  it('offers no jump for popups synthesized from a data attribute', async () => {
    await renderPopup();
    const element = document.createElement('span');
    document.body.appendChild(element);
    await act(async () => {
      await eventDispatcher.dispatch('footnote-popup', {
        bookKey: BOOK_KEY,
        element,
        footnote: 'A footnote with no document behind it',
      });
    });

    expect(screen.getByTestId('popup').dataset['open']).toBe('true');
    expect(screen.queryByLabelText('Jump to Location')).toBeNull();
  });
});
