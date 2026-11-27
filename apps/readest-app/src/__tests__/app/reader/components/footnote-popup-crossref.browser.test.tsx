/**
 * A cross-reference in the text to a note whose marker is declared elsewhere
 * in the chapter opens the note as that marker does (#7982).
 *
 * The reporter's chapter has three note markers in one paragraph and then
 * `〔原注47参照〕`, a plain link to note 47. The markers made the reader take the
 * paragraph for a list of chapter links, so the link was followed to the
 * note's place at the end of the chapter.
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
import { BookDoc } from '@/libs/document';

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Chapter 1</title></head>
<body>
<p>
  ダミーテキスト一二三四五（<a href="ch1.xhtml#note-1" epub:type="noteref" role="doc-noteref">1</a>）。
  ダミーテキスト六七八九十（<a href="ch1.xhtml#note-2" epub:type="noteref" role="doc-noteref">2</a>）。
  さらにダミーテキスト（<a href="ch1.xhtml#note-3" epub:type="noteref" role="doc-noteref">3</a>）。
  途中の参照リンク〔<a href="ch1.xhtml#note-47">原注<span>47</span></a>参照〕がここにある。
</p>
<p>
  次の段落のダミーテキスト<span id="ref-47">（<a href="ch1.xhtml#note-47" epub:type="noteref" role="doc-noteref">47</a>）</span>。
</p>
<hr/>
<aside id="note-3" epub:type="footnote" role="doc-footnote">
  <p><a href="ch1.xhtml#ch1" role="doc-backlink">3</a>　ダミー注釈3の内容です。</p>
</aside>
<p id="note-47"><a href="ch1.xhtml#ref-47" role="doc-backlink">47</a>　ダミー注釈47の本文。書誌名<span class="italic">Lorem Ipsum</span>、第2巻<span class="italic">Dolor Sit</span>、および<span class="italic">Amet Consectetur</span>を参照。</p>
<aside id="note-48" epub:type="footnote" role="doc-footnote">
  <p><a href="ch1.xhtml#ref-48" role="doc-backlink">48</a>　ダミー注釈48の内容です。</p>
</aside>
</body>
</html>`;

const makeBook = () => {
  const url = URL.createObjectURL(new Blob([CHAPTER], { type: 'application/xhtml+xml' }));
  return {
    dir: 'ltr',
    sections: [
      {
        id: 'ch1.xhtml',
        linear: 'yes',
        size: CHAPTER.length,
        load: () => url,
        loadContent: () => CHAPTER,
        unload: () => {},
        resolveHref: (href: string) => href,
      },
    ],
    resolveHref: (href: string) => {
      const id = href.split('#')[1]!;
      return { index: 0, anchor: (doc: Document) => doc.getElementById(id) };
    },
  };
};

let cell: HTMLElement;

beforeAll(async () => {
  await import('foliate-js/view.js');
});

beforeEach(() => {
  h.handlers.length = 0;
  h.goTo.mockClear();
  h.onLinkClick.current = null;
  // The chapter as the reader holds it: an XHTML document, epub:type namespaced.
  const doc = new DOMParser().parseFromString(CHAPTER, 'application/xhtml+xml');
  cell = document.createElement('div');
  cell.id = 'gridcell-book-1';
  cell.style.cssText = 'position:fixed;inset:0;';
  for (const node of Array.from(doc.body.childNodes))
    cell.appendChild(document.importNode(node, true));
  document.body.appendChild(cell);
});

afterEach(() => {
  cell.remove();
  cleanup();
});

const popupText = () =>
  document
    .querySelector<HTMLElement & { renderer?: { getContents?: () => { doc: Document }[] } }>(
      '#popup-container foliate-view',
    )
    ?.renderer?.getContents?.()[0]?.doc.body.textContent ?? '';

describe('cross-reference to a declared note (#7982)', () => {
  test('opens the note in the popup instead of jumping to it', async () => {
    render(<FootnotePopup bookKey='book-1' bookDoc={makeBook() as unknown as BookDoc} />);
    const crossRef = Array.from(cell.querySelectorAll('a')).find(
      (a) => a.textContent === '原注47',
    )!;
    const event = new CustomEvent('link', {
      detail: { a: crossRef, href: 'ch1.xhtml#note-47' },
      cancelable: true,
    });
    act(() => {
      h.onLinkClick.current?.(event);
    });

    expect(event.defaultPrevented).toBe(true);
    const popup = document.querySelector<HTMLElement>('#popup-container')!;
    // The popup shows once its own view has loaded the note's section, which
    // takes longer than waitFor's default second on a loaded machine
    await vi.waitFor(() => expect(popup.getAttribute('aria-hidden')).toBe('false'), {
      timeout: 5000,
    });
    await vi.waitFor(() => expect(popupText()).toContain('ダミー注釈47の本文'));
    expect(popupText()).not.toContain('ダミー注釈48');
    expect(h.goTo).not.toHaveBeenCalled();
  });
});
