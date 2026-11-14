/**
 * Footnote popup strict-check gating (#7537).
 *
 * Readest asks foliate-js to strictly validate a footnote (`detail.check`)
 * when the only evidence is a bare numeric marker. Foliate's strict check
 * rejects any extracted note body with more than three element children —
 * a false positive for a richly formatted note (backlink + marker +
 * emphasis runs). The rejection falls back to jumping the main view to the
 * note instead of showing the popup.
 *
 * A superscript marker already confirms the reference (foliate's own
 * `maybe()`), so such links must not earn the strict check. A plain numeric
 * link, detected by text alone, still must.
 */
import { bookDataStoreHooks } from '@/__tests__/helpers/book-data-store-mock';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { BookDoc } from '@/libs/document';

const BOOK_KEY = 'bookid-0';

const hoisted = vi.hoisted(() => ({
  handlers: [] as EventTarget[],
  onLinkClick: { current: null as ((event: Event) => void) | null },
  handle: vi.fn(() => Promise.resolve()),
  goTo: vi.fn(),
  isLinkTargetVisible: vi.fn(() => true),
  showTransientHighlight: vi.fn(),
}));

vi.mock('foliate-js/footnotes.js', () => {
  class FootnoteHandler extends EventTarget {
    handle = hoisted.handle;
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

vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    getView: () => ({ goTo: hoisted.goTo }),
    getViewSettings: () => ({
      vertical: false,
      defaultFontSize: 22,
      lineHeight: 1.8,
      fontWeight: 300,
      wordLensEnabled: false,
    }),
  }),
}));

const bookDataState = {
  booksData: { bookid: { config: { booknotes: [] } } },
  getBookData: () => ({ book: { primaryLanguage: 'en' } }),
};
vi.mock('@/store/bookDataStore', () => ({
  ...bookDataStoreHooks(
    Object.assign(
      (selector?: (state: typeof bookDataState) => unknown) =>
        selector ? selector(bookDataState) : bookDataState,
      { getState: () => bookDataState },
    ),
  ),
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

vi.mock('@/store/vocabularyStore', () => ({
  useVocabularyStore: () => ({
    getLearningAndMastered: () => ({ learning: new Map(), mastered: new Set() }),
  }),
}));

vi.mock('@/services/wordlens/glossPacks', () => ({
  loadGlossIndex: vi.fn().mockResolvedValue(null),
}));

// The WASM-backed converter is not installed in this checkout's node_modules
// (a full `pnpm install` provides it); it is unrelated to the check gating,
// so stub it rather than pulling the binary in.
vi.mock('@/utils/simplecc', () => ({
  initSimpleCC: vi.fn().mockResolvedValue(undefined),
  runSimpleCC: (text: string) => text,
}));

vi.mock('@/utils/style', () => ({
  applyLinkHitArea: vi.fn(),
  keepTextAlignment: () => {},
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

vi.mock('@/app/reader/utils/footnoteCfi', () => ({
  getFootnoteLocalCfi: () => 'local-cfi',
  getFootnoteSelectionCfi: () => null,
}));

vi.mock('@/components/Overlay', () => ({
  Overlay: () => <div data-testid='overlay' />,
}));

vi.mock('@/components/Popup', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid='popup'>{children}</div>
  ),
}));

// NOTE: '@/app/reader/utils/footnoteHeuristics' is intentionally NOT mocked
// here: this test asserts the real heuristic decision in docLinkHandler.

const renderPopup = async () => {
  const grid = document.createElement('div');
  grid.id = `gridcell-${BOOK_KEY}`;
  document.body.appendChild(grid);
  const { default: FootnotePopup } = await import('@/app/reader/components/FootnotePopup');
  return render(<FootnotePopup bookKey={BOOK_KEY} bookDoc={{} as BookDoc} />);
};

/** Click a link in the book and return the detail handed to FootnoteHandler. */
const clickLink = async (anchorHtml: string, href: string) => {
  const wrapper = document.createElement('p');
  wrapper.innerHTML = anchorHtml;
  document.body.appendChild(wrapper);
  const anchor = wrapper.querySelector('a')!;
  await act(async () => {
    hoisted.onLinkClick.current?.(
      new CustomEvent('link', { detail: { a: anchor, href }, cancelable: true }),
    );
  });
  const call = hoisted.handle.mock.calls.at(-1);
  expect(call).toBeDefined();
  return (call![1] as CustomEvent).detail as { check?: boolean; follow?: boolean };
};

describe('FootnotePopup strict-check gating (#7537)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    hoisted.handlers.length = 0;
    hoisted.onLinkClick.current = null;
    hoisted.handle.mockClear();
    hoisted.goTo.mockClear();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('does not ask for strict validation for a <sup> footnote marker (#7537)', async () => {
    await renderPopup();
    // The reporter's Section0001 footnote: <a href="#id_12"><sup>1</sup></a>
    // whose note body carries a backlink, a marker and five <em> runs (seven
    // element children) — foliate's strict check would reject it as
    // "Failed to locate footnote content".
    const detail = await clickLink(
      '<a href="#id_12"><sup>1</sup></a>',
      'text/Section0001.html#id_12',
    );
    expect(detail.check).toBeUndefined();
  });

  it('does not ask for strict validation when the marker sits inside a <sup>', async () => {
    await renderPopup();
    // The reporter's part0005 footnote: <sup><a><span>1</span></a></sup>.
    const detail = await clickLink(
      '<sup><a href="part0005.html#f_1"><span id="n_1">1</span></a></sup>',
      'text/part0005.html#f_1',
    );
    expect(detail.check).toBeUndefined();
  });

  it('still asks for strict validation for a bare numeric link', async () => {
    await renderPopup();
    const detail = await clickLink('Body text<a href="#n1">1</a> more text', 'text/chapter.html#n1');
    expect(detail.check).toBe(true);
  });
});
