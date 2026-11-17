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
}));

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
import { BookDoc } from '@/libs/document';

// A bare numeric reference, which earns `check`, to a note whose body has more
// than three element children, which `check` rejects.
const SECTION_BODY = `
  <h1>Chapter heading</h1>
  <p>Body text<a id="r1"></a><a href="#n1">1</a> more text.</p>
  <hr/>
  <p><a href="#r1"></a><a id="n1">1.</a><em> Lorem</em> ipsum <em>dolor</em> sit
  <em>amet</em>, see <em>Lorem ipsum</em>.</p>
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

beforeEach(() => {
  h.goTo.mockClear();
  h.onLinkClick.current = null;
  cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  cell.style.cssText = 'position:fixed;inset:0;';
  cell.innerHTML = '<p>Body text<a href="#n1">1</a> more text.</p>';
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

    await vi.waitFor(() => expect(h.goTo).toHaveBeenCalledWith('chapter.html#n1'));
    // The content-size observer reports on the next frame and shows the popup
    // on the one after.
    await nextFrame();
    await nextFrame();
    await nextFrame();
    const popup = document.querySelector<HTMLElement>('#popup-container')!;
    expect(popup.getAttribute('aria-hidden')).toBe('true');
  });
});
