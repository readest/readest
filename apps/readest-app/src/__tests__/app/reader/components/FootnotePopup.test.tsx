/**
 * Footnote popup "Jump to Location" (#5766).
 *
 * A link pointing at an appendix or a long section only ever renders as its
 * heading in the popup (foliate's #showFragment falls through to
 * `range.selectNode(el)`), so a popup backed by a book document must offer a
 * way out to the real page. Popups synthesized from a `data-*` attribute have
 * no location in the book and must not offer one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  applyLinkHitArea: vi.fn(),
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
    getViewSettings: () => ({
      vertical: false,
      defaultFontSize: 22,
      lineHeight: 1.8,
      fontWeight: 300,
    }),
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
  applyLinkHitArea: hoisted.applyLinkHitArea,
  getBaseFontFamily: () => '"Reader Font", serif',
  getBaseFontSize: () => 22,
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

// Map every booknote into whatever popup is open, as a fragment path shared
// by two sections would; which section a note belongs to is then left to the
// popup's own spine check.
vi.mock('@/app/reader/utils/footnoteCfi', () => ({
  getFootnoteLocalCfi: () => 'local-cfi',
  getFootnoteSelectionCfi: () => null,
}));

vi.mock('@/components/Overlay', () => ({
  Overlay: () => <div data-testid='overlay' />,
}));

// The real Popup keeps its children mounted and only moves them off-screen
// when closed, which FootnotePopup relies on to fill `footnoteRef` ahead of
// the first render.
vi.mock('@/components/Popup', () => ({
  default: ({
    isOpen,
    height,
    trianglePosition,
    children,
  }: {
    isOpen?: boolean;
    height?: number;
    trianglePosition?: { point: { y: number } };
    children: ReactNode;
  }) => (
    <div
      data-testid='popup'
      data-open={isOpen ? 'true' : 'false'}
      data-height={height}
      data-anchor-y={trianglePosition?.point.y}
    >
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

describe('FootnotePopup link hit area', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    hoisted.handlers.length = 0;
    hoisted.onLinkClick.current = null;
    hoisted.applyLinkHitArea.mockReset();
  });

  it('opts the popup document in to the enlarged link hit area', async () => {
    await renderPopup();
    const anchor = document.createElement('a');
    anchor.setAttribute('href', HREF);
    document.body.appendChild(anchor);
    await act(async () => {
      hoisted.onLinkClick.current?.(
        new CustomEvent('link', { detail: { a: anchor, href: HREF }, cancelable: true }),
      );
    });
    const view = createPopupView();
    const doc = document.implementation.createHTMLDocument();
    Object.assign((view as unknown as { renderer: object }).renderer, {
      getContents: () => [{ doc, index: 3 }],
    });
    await act(async () => {
      hoisted.handlers
        .at(-1)!
        .dispatchEvent(
          new CustomEvent('render', { detail: { view, href: HREF, index: 3, extract: null } }),
        );
    });

    expect(hoisted.applyLinkHitArea).toHaveBeenCalledWith(doc);
  });
});

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

  describe('selection reports (#6395)', () => {
    const loadPopupDoc = async () => {
      await renderPopup();
      const view = await openFootnotePopup();
      const iframe = document.createElement('iframe');
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument!;
      doc.body.innerHTML = '<p>A footnote with a highlight in it.</p>';
      await act(async () => {
        view.dispatchEvent(new CustomEvent('load', { detail: { doc, index: 3 } }));
      });
      const dispatch = vi.spyOn(eventDispatcher, 'dispatch');
      const cleared = () =>
        dispatch.mock.calls.filter(
          ([name, detail]) => name === 'footnote-selection' && !(detail as { range?: Range }).range,
        ).length;
      return { doc, view, dispatch, cleared };
    };

    const settle = async () => {
      await act(async () => {
        vi.advanceTimersByTime(300);
      });
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.restoreAllMocks();
      vi.stubGlobal(
        'ResizeObserver',
        class {
          observe() {}
          disconnect() {}
        },
      );
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    // A tap on a highlight opens the toolbar from its click, and on touch
    // devices the caret it drops lands after that; the debounced report of it
    // used to close the toolbar the tap had just opened.
    it('does not report a clear for a caret when no selection was reported', async () => {
      const { doc, cleared } = await loadPopupDoc();

      doc.getSelection()!.collapse(doc.body.firstChild!.firstChild!, 3);
      doc.dispatchEvent(new Event('selectionchange'));
      await settle();

      expect(cleared()).toBe(0);
    });

    it('reports a clear once a reported selection collapses', async () => {
      const { doc, dispatch, cleared } = await loadPopupDoc();

      doc.getSelection()!.selectAllChildren(doc.body.firstChild!);
      doc.dispatchEvent(new Event('selectionchange'));
      await settle();
      expect(dispatch).toHaveBeenCalledWith(
        'footnote-selection',
        expect.objectContaining({ range: expect.anything() }),
      );

      doc.getSelection()!.removeAllRanges();
      doc.dispatchEvent(new Event('selectionchange'));
      await settle();

      expect(cleared()).toBe(1);
    });

    // A tap elsewhere in the note is how a highlight's toolbar gets dismissed.
    it('reports a clear for a tap that leaves no selection', async () => {
      const { doc, cleared } = await loadPopupDoc();

      doc.dispatchEvent(new Event('pointerup'));

      expect(cleared()).toBe(1);
    });
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

  // #3602: the synthesized note renders in the host document, outside the
  // book iframe, so it inherited the app UI font instead of the reader's.
  it('sets a data-attribute note in the reader font', async () => {
    await renderPopup();
    const element = document.createElement('span');
    document.body.appendChild(element);
    await act(async () => {
      await eventDispatcher.dispatch('footnote-popup', {
        bookKey: BOOK_KEY,
        element,
        footnote: 'A footnote in the reader font',
      });
    });

    const note = document.querySelector<HTMLElement>('.footnote-content > p')!;
    expect(note.style.fontFamily).toBe('"Reader Font", serif');
    expect(note.style.fontSize).toBe('22px');
    expect(note.style.lineHeight).toBe('1.8');
    expect(note.style.fontWeight).toBe('300');
  });

  // #6390: the soft keyboard the note editor raises fires a window resize on
  // Android without the window changing width, which closed the popup under
  // the editor. Only a real width change (rotation, window resize) moves the
  // anchor out from under the popup.
  it('stays open through a resize that keeps the window width', async () => {
    await renderPopup();
    await openFootnotePopup();

    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('popup').dataset['open']).toBe('true');

    const width = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { value: width + 100, configurable: true });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
    expect(screen.getByTestId('popup').dataset['open']).toBe('false');
  });

  // #6390 review: a range-editor preview is dispatched after an await, so it
  // can land once the popup shows another section. It must not draw there.
  it('draws a drag preview only for a note in the section the popup shows', async () => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    await renderPopup();
    const anchor = document.createElement('a');
    anchor.setAttribute('href', HREF);
    document.body.appendChild(anchor);
    await act(async () => {
      hoisted.onLinkClick.current?.(
        new CustomEvent('link', { detail: { a: anchor, href: HREF }, cancelable: true }),
      );
    });
    const handler = hoisted.handlers.at(-1)!;
    const view = Object.assign(createPopupView(), {
      getCFI: () => 'epubcfi(/6/8!/4)',
      addAnnotation: vi.fn(),
    });
    await act(async () => {
      handler.dispatchEvent(new CustomEvent('before-render', { detail: { view } }));
      handler.dispatchEvent(
        new CustomEvent('render', { detail: { view, href: HREF, index: 3, extract: {} } }),
      );
      view.dispatchEvent(
        new CustomEvent('load', {
          detail: { doc: document.implementation.createHTMLDocument(), index: 3 },
        }),
      );
      view.dispatchEvent(new CustomEvent('relocate', { detail: {} }));
    });
    const note = (id: string, cfi: string) => ({
      id,
      type: 'annotation',
      cfi,
      style: 'highlight',
      color: 'yellow',
      updatedAt: 1,
    });

    await act(async () => {
      await eventDispatcher.dispatch('footnote-annotation-preview', {
        key: BOOK_KEY,
        note: note('elsewhere', 'epubcfi(/6/4!/4/2,/1:0,/1:5)'),
      });
    });
    expect(view.addAnnotation).not.toHaveBeenCalled();

    await act(async () => {
      await eventDispatcher.dispatch('footnote-annotation-preview', {
        key: BOOK_KEY,
        note: note('here', 'epubcfi(/6/8!/4/2,/1:0,/1:5)'),
      });
    });
    expect(view.addAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'here', value: 'local-cfi' }),
    );
  });

  // #6390: near a page edge the highlight toolbar has no room on the side the
  // popup left free, so it stays by the word and the popup opens beyond it.
  describe('with the highlight toolbar on its side', () => {
    const block = (value: { dir: string; size: number } | null) =>
      act(async () => {
        await eventDispatcher.dispatch('annotation-toolbar-block', { key: BOOK_KEY, block: value });
      });

    it('opens beyond the toolbar, refitted to the room left', async () => {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
      await renderPopup();
      await openFootnotePopup();
      const popup = screen.getByTestId('popup');
      expect(popup.dataset['anchorY']).toBe('10');
      expect(popup.dataset['height']).toBe('242');

      await block({ dir: 'down', size: 100 });

      expect(popup.dataset['anchorY']).toBe('110');
      // 300 tall, anchored at 110 with 10px padding: 180px left, not 242.
      expect(popup.dataset['height']).toBe('180');
    });

    it('stays put when the toolbar goes away while it is open', async () => {
      await renderPopup();
      await openFootnotePopup();
      await block({ dir: 'down', size: 100 });

      await block(null);

      expect(screen.getByTestId('popup').dataset['anchorY']).toBe('110');
    });
  });
});
