// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * While a book opens, its cell builds the page, the running head and footer and
 * the toolbars' always-on parts. The rest (the annotator, the footnote popup,
 * the ink layer, the page buttons and the hidden navigation bars) is built
 * once the first page has been painted: on an e-ink reader running QuickJS
 * (Readest Lite) building it with the page took ~0.8 s of a book open.
 */

const h = vi.hoisted(() => {
  const mounted = {
    Annotator: false,
    FootnotePopup: false,
    HandwritingOverlay: false,
    PageNavigationButtons: false,
    BookmarkPullDown: false,
    SearchResultsNav: false,
    BooknotesNav: false,
    VimCommandLine: false,
    HintInfo: false,
    ReadingStatsTracker: false,
    FoliateViewer: false,
    SectionInfo: false,
    ProgressBar: false,
    HeaderBar: false,
    FooterBar: false,
  };
  const view = { renderer: { columnCount: 1 } };
  const marker = (name: keyof typeof mounted) => ({
    default: () => {
      mounted[name] = true;
      return null;
    },
  });
  return { mounted, view, marker };
});

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (state: { settings: { alwaysShowStatusBar: boolean } }) => unknown) =>
    select({ settings: { alwaysShowStatusBar: false } }),
}));
vi.mock('@/store/sidebarStore', () => ({ useSidebarStore: () => null }));
vi.mock('@/store/bookDataStore', () => {
  const data = {
    book: { title: 'Book', format: 'EPUB' },
    bookDoc: { toc: [] },
    isFixedLayout: false,
  };
  const state = { getConfig: () => ({ location: 'cfi' }), getBookData: () => data };
  return { useBookDataStore: (select: (s: typeof state) => unknown) => select(state) };
});
vi.mock('@/utils/window', () => ({ tauriSetWindowTitle: vi.fn() }));
vi.mock('@/app/reader/hooks/useContentInsets', () => ({ useContentInsets: () => ({}) }));
vi.mock('@/app/reader/hooks/usePageOverflow', () => ({ usePageOverflow: () => false }));

vi.mock('@/app/reader/components/annotator/Annotator', () => h.marker('Annotator'));
vi.mock('@/app/reader/components/FootnotePopup', () => h.marker('FootnotePopup'));
vi.mock('@/app/reader/components/handwriting/HandwritingOverlay', () =>
  h.marker('HandwritingOverlay'),
);
vi.mock('@/app/reader/components/PageNavigationButtons', () => h.marker('PageNavigationButtons'));
vi.mock('@/app/reader/components/BookmarkPullDown', () => h.marker('BookmarkPullDown'));
vi.mock('@/app/reader/components/sidebar/SearchResultsNav', () => h.marker('SearchResultsNav'));
vi.mock('@/app/reader/components/sidebar/BooknotesNav', () => h.marker('BooknotesNav'));
vi.mock('@/app/reader/components/VimCommandLine', () => h.marker('VimCommandLine'));
vi.mock('@/app/reader/components/HintInfo', () => h.marker('HintInfo'));
vi.mock('@/app/reader/components/ReadingStatsTracker', () => h.marker('ReadingStatsTracker'));
vi.mock('@/app/reader/components/FoliateViewer', () => h.marker('FoliateViewer'));
vi.mock('@/app/reader/components/SectionInfo', () => h.marker('SectionInfo'));
vi.mock('@/app/reader/components/ProgressBar', () => h.marker('ProgressBar'));
vi.mock('@/app/reader/components/HeaderBar', () => h.marker('HeaderBar'));
vi.mock('@/app/reader/components/footerbar/FooterBar', () => h.marker('FooterBar'));
vi.mock('@/app/reader/components/ReadingRuler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/DoubleBorder', () => ({ default: () => null }));

import BooksGrid from '@/app/reader/components/BooksGrid';
import { useReaderStore, type ViewState } from '@/store/readerStore';

const ON_FIRST_PAGE = [
  'FoliateViewer',
  'SectionInfo',
  'ProgressBar',
  'HeaderBar',
  'FooterBar',
] as const;
const AFTER_FIRST_PAGE = (Object.keys(h.mounted) as Array<keyof typeof h.mounted>).filter(
  (name) => !(ON_FIRST_PAGE as readonly string[]).includes(name),
);

const setInited = (inited: boolean) =>
  act(() =>
    useReaderStore.setState((s) => ({
      viewStates: { 'book-1': { ...s.viewStates['book-1']!, inited } },
    })),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
  for (const name of Object.keys(h.mounted) as Array<keyof typeof h.mounted>) {
    h.mounted[name] = false;
  }
  useReaderStore.setState({
    hoveredBookKey: null,
    viewStates: {
      'book-1': {
        key: 'book-1',
        viewerKey: 'v1',
        view: h.view,
        isPrimary: true,
        inited: false,
        viewSettings: {
          columnGapPx: 24,
          gapPercent: 5,
          showHeader: true,
          showFooter: true,
        },
      } as unknown as ViewState,
    },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const renderGrid = () =>
  render(<BooksGrid bookKeys={['book-1']} onCloseBook={vi.fn()} onGoToLibrary={vi.fn()} />);

describe('BooksGrid while a book opens', () => {
  it('builds the page and its running head and footer at once', () => {
    renderGrid();
    for (const name of ON_FIRST_PAGE) expect(h.mounted[name], name).toBe(true);
  });

  it('builds the rest once the first page has been painted', () => {
    renderGrid();
    for (const name of AFTER_FIRST_PAGE) expect(h.mounted[name], name).toBe(false);

    // The view went to the first page: it is painted with the next frame
    setInited(true);
    act(() => vi.advanceTimersToNextFrame());
    for (const name of AFTER_FIRST_PAGE) expect(h.mounted[name], name).toBe(false);
    act(() => vi.runOnlyPendingTimers());

    for (const name of AFTER_FIRST_PAGE) expect(h.mounted[name], name).toBe(true);
  });

  it('builds everything at once for a book whose first page is already shown', () => {
    setInited(true);
    renderGrid();
    for (const name of Object.keys(h.mounted)) {
      expect(h.mounted[name as keyof typeof h.mounted], name).toBe(true);
    }
  });
});
