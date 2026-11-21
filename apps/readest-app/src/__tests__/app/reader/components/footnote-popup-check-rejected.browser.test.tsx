/**
 * A footnote foliate rejects under `check` must not leave a popup behind
 * (#7537).
 *
 * foliate rejects inside the popup view's `load`, before it extracts the note,
 * so the view still holds the whole section. The reader's own `load` listener
 * runs next and starts sizing the popup to that content, which showed it. The
 * reader fell back to jumping the main view to the note, so the reporter saw
 * both at once: a jump and a popup showing the whole chapter.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import '@/styles/globals.css';

const h = vi.hoisted(() => ({
  goTo: vi.fn(),
  onLinkClick: { current: null as ((event: Event) => void) | null },
  handlers: [] as { handle: (...args: unknown[]) => Promise<void> | undefined }[],
}));

// The real handler, recorded so a test can hold one request back.
vi.mock('foliate-js/footnotes.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('foliate-js/footnotes.js')>();
  class RecordedFootnoteHandler extends mod.FootnoteHandler {
    constructor() {
      super();
      h.handlers.push(this as unknown as (typeof h.handlers)[number]);
    }
  }
  return { ...mod, FootnoteHandler: RecordedFootnoteHandler };
});

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: { isMobile: false } }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ goTo: h.goTo }),
    getViewSettings: () => ({ vertical: false, rtl: false, scrolled: false }),
  }),
}));
vi.mock('@/store/bookDataStore', () => {
  const state = { booksData: {}, getBookData: () => ({ book: {} }) };
  const store = (selector?: (s: unknown) => unknown) => (selector ? selector(state) : state);
  store.getState = () => state;
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
vi.mock('@/app/reader/utils/annotatorUtil', () => ({ drawAnnotationOverlay: () => {} }));
vi.mock('@/app/reader/utils/transientHighlight', () => ({ showTransientHighlight: () => {} }));
vi.mock('@/utils/style', () => ({
  applyLinkHitArea: () => {},
  keepTextAlignment: () => {},
  getBaseFontFamily: () => 'serif',
  getBaseFontSize: () => 16,
  getStyles: () => '',
  getFootnoteStyles: () => '',
  getThemeCode: () => ({ bg: '#fff', fg: '#000' }),
}));
vi.mock('@/styles/fonts', () => ({
  mountAdditionalFonts: () => {},
  mountCustomFont: () => {},
}));

import FootnotePopup from '@/app/reader/components/FootnotePopup';
import { eventDispatcher } from '@/utils/event';
import { BookDoc } from '@/libs/document';

// A bare numeric reference, which earns `check`, to a note whose body has more
// than three element children and no link back, which `check` rejects.
const SECTION_BODY = `
  <h1>Chapter heading</h1>
  <p>Body text<a id="r1"></a><a href="#n1">1</a> more text.</p>
  <hr/>
  <p><a id="n1">1.</a><em> Lorem</em> ipsum <em>dolor</em> sit
  <em>amet</em>, see <em>Lorem ipsum</em>.</p>
  <p id="n2">A short second note.</p>
`;

const makeBook = () => {
  const content = `<!DOCTYPE html><html><head><title>T</title></head><body>${SECTION_BODY}</body></html>`;
  const url = URL.createObjectURL(new Blob([content], { type: 'text/html' }));
  return {
    dir: 'ltr',
    sections: [
      {
        id: 'chapter.html',
        linear: 'yes',
        size: content.length,
        load: () => url,
        loadContent: () => content,
        unload: () => {},
        resolveHref: (href: string) => (href.startsWith('#') ? `chapter.html${href}` : href),
      },
    ],
    resolveHref: (href: string) => {
      const id = href.split('#')[1]!;
      return { index: 0, anchor: (doc: Document) => doc.getElementById(id) };
    },
  };
};

const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

let cell: HTMLElement;
let anchor: HTMLAnchorElement;

beforeAll(async () => {
  await import('foliate-js/view.js');
});

const click = (a: HTMLAnchorElement, href: string) =>
  act(() => {
    h.onLinkClick.current?.(new CustomEvent('link', { detail: { a, href }, cancelable: true }));
  });

beforeEach(() => {
  h.handlers.length = 0;
  h.goTo.mockClear();
  h.onLinkClick.current = null;
  cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  cell.style.cssText = 'position:fixed;inset:0;';
  cell.innerHTML = '<p>Body text<a href="#n1">1</a> more text.<a href="#n2"><sup>2</sup></a></p>';
  anchor = cell.querySelector('a')!;
  document.body.appendChild(cell);
});

afterEach(() => {
  cell.remove();
  cleanup();
});

describe('footnote rejected by check (#7537)', () => {
  test('jumps to the note and leaves the popup hidden', async () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={makeBook() as unknown as BookDoc} />);
    act(() => {
      h.onLinkClick.current?.(
        new CustomEvent('link', {
          detail: { a: anchor, href: 'chapter.html#n1' },
          cancelable: true,
        }),
      );
    });

    await vi.waitFor(() => expect(h.goTo).toHaveBeenCalledWith('chapter.html#n1', { focus: true }));
    // The content-size observer reports on the next frame and shows the popup
    // on the one after.
    await nextFrame();
    await nextFrame();
    await nextFrame();
    const popup = document.querySelector<HTMLElement>('#popup-container')!;
    expect(popup.getAttribute('aria-hidden')).toBe('true');
  });

  test('a superseded request that rejects leaves the newer popup open', async () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={makeBook() as unknown as BookDoc} />);
    const handler = h.handlers.at(-1)!;
    const realHandle = handler.handle.bind(handler);
    let rejectFirst: (err: Error) => void = () => {};
    vi.spyOn(handler, 'handle')
      .mockImplementationOnce(
        () =>
          new Promise<void>((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementation(realHandle);

    click(anchor, 'chapter.html#n1');
    click(cell.querySelectorAll('a')[1]!, 'chapter.html#n2');
    const popup = document.querySelector<HTMLElement>('#popup-container')!;
    await vi.waitFor(() => expect(popup.getAttribute('aria-hidden')).toBe('false'));
    for (let i = 0; i < 5; i++) await nextFrame();
    // The newer popup can re-open itself on its next relocate, so record every
    // change rather than sampling the end state.
    const states: (string | null)[] = [];
    const observer = new MutationObserver(() => states.push(popup.getAttribute('aria-hidden')));
    observer.observe(popup, { attributes: true, attributeFilter: ['aria-hidden'] });

    await act(async () => rejectFirst(new Error('Failed to locate footnote content')));
    await nextFrame();
    await nextFrame();
    observer.disconnect();
    expect(states).not.toContain('true');
    expect(popup.getAttribute('aria-hidden')).toBe('false');
  });

  test('a pending link that rejects leaves a data-attribute popup open', async () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={makeBook() as unknown as BookDoc} />);
    const handler = h.handlers.at(-1)!;
    let rejectFirst: (err: Error) => void = () => {};
    vi.spyOn(handler, 'handle').mockImplementationOnce(
      () =>
        new Promise<void>((_, reject) => {
          rejectFirst = reject;
        }),
    );

    click(anchor, 'chapter.html#n1');
    await act(async () => {
      await eventDispatcher.dispatch('footnote-popup', {
        bookKey: 'book-1',
        element: anchor,
        footnote: 'A note kept in a data attribute.',
      });
    });
    const popup = document.querySelector<HTMLElement>('#popup-container')!;
    await vi.waitFor(() => expect(popup.getAttribute('aria-hidden')).toBe('false'));

    await act(async () => rejectFirst(new Error('Failed to locate footnote content')));
    await nextFrame();
    expect(popup.getAttribute('aria-hidden')).toBe('false');
  });
});
