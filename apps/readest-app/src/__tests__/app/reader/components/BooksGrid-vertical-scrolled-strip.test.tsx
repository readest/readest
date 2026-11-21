// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Vertical scrolled mode masks the side margins with opaque strips. At a 0px
 * left margin the left strip may only cover the 16px FoliateViewer reserves
 * for the footer (footerReservesBand); otherwise it hides the text's edge.
 */

const h = vi.hoisted(() => {
  const view = { renderer: { columnCount: 1 } };
  const viewSettings = {
    vertical: true,
    scrolled: true,
    showHeader: false,
    showFooter: true,
    showProgressInfo: true,
    showStickyProgressBar: false,
    solidScrolledFooter: false,
    doubleBorder: false,
    columnGapPx: 24,
    gapPercent: 5,
  };
  const viewState = { viewSettings, viewerKey: 'v1', inited: true, view };
  return { view, viewSettings, viewState, stub: { default: () => null } };
});

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (state: { settings: { alwaysShowStatusBar: boolean } }) => unknown) =>
    select({ settings: { alwaysShowStatusBar: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({
      hoveredBookKey: null,
      setGridInsets: () => {},
      viewStates: { 'book-1': h.viewState },
      getView: () => h.view,
    }),
}));
vi.mock('@/store/sidebarStore', () => ({ useSidebarStore: () => null }));
vi.mock('@/store/bookDataStore', () => {
  const data = { book: { title: 'Book', format: 'EPUB' }, bookDoc: { toc: [] } };
  const state = { getConfig: () => ({ location: 'cfi' }), getBookData: () => data };
  return { useBookDataStore: (select: (s: typeof state) => unknown) => select(state) };
});
vi.mock('@/utils/window', () => ({ tauriSetWindowTitle: vi.fn() }));
vi.mock('@/app/reader/hooks/useContentInsets', () => ({
  useContentInsets: () => ({
    viewInsets: { top: 16, right: 0, bottom: 16, left: 0 },
    contentInsets: { top: 16, right: 0, bottom: 16, left: 0 },
  }),
}));
vi.mock('@/app/reader/hooks/usePageOverflow', () => ({ usePageOverflow: () => false }));
for (const path of [
  '@/app/reader/components/HeaderBar',
  '@/app/reader/components/annotator/Annotator',
  '@/app/reader/components/FootnotePopup',
  '@/app/reader/components/handwriting/HandwritingOverlay',
  '@/app/reader/components/SectionInfo',
  '@/app/reader/components/HintInfo',
  '@/app/reader/components/sidebar/SearchResultsNav',
  '@/app/reader/components/sidebar/BooknotesNav',
  '@/app/reader/components/VimCommandLine',
  '@/app/reader/components/FoliateViewer',
  '@/app/reader/components/PageNavigationButtons',
  '@/app/reader/components/footerbar/FooterBar',
  '@/app/reader/components/ProgressBar',
  '@/app/reader/components/BookmarkPullDown',
  '@/app/reader/components/ReadingRuler',
  '@/app/reader/components/DoubleBorder',
  '@/app/reader/components/ReadingStatsTracker',
]) {
  vi.doMock(path, () => h.stub);
}

const { default: BooksGrid } = await import('@/app/reader/components/BooksGrid');

afterEach(cleanup);

const leftStripWidth = () => {
  const { container } = render(
    <BooksGrid bookKeys={['book-1']} onCloseBook={vi.fn()} onGoToLibrary={vi.fn()} />,
  );
  const strip = container.querySelector<HTMLElement>('.bg-base-100.absolute.left-0.top-0.h-full');
  return strip?.style.width;
};

describe('BooksGrid vertical scrolled left strip at a 0px margin', () => {
  it('leaves the text uncovered when the footer floats (Solid Footer off)', () => {
    h.viewSettings.solidScrolledFooter = false;
    expect(leftStripWidth()).toBe('calc(0px)');
  });

  it('covers the 16px band reserved for a solid footer', () => {
    h.viewSettings.solidScrolledFooter = true;
    expect(leftStripWidth()).toBe('calc(16px)');
  });
});
