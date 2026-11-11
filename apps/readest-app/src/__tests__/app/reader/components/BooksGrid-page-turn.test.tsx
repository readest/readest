// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A page turn writes the book's progress. The cell re-renders only for what it
 * shows from it (the section label, the column gap); the chrome around the page
 * subscribes to what it needs, so a turn within a section does not re-render
 * it through the cell.
 */

const h = vi.hoisted(() => {
  const renders = { HeaderBar: 0, Annotator: 0, FootnotePopup: 0, HandwritingOverlay: 0 };
  const sectionLabels: Array<string | undefined> = [];
  const columnGaps: number[] = [];
  const view = { renderer: { columnCount: 1 } };
  const viewSettings = { columnGapPx: 24, gapPercent: 5, showHeader: true, showFooter: true };
  const viewState = { viewSettings, viewerKey: 'v1', inited: true, view };
  const counted = (name: keyof typeof renders) => ({
    default: () => {
      renders[name]++;
      return null;
    },
  });
  const stub = { default: () => null };
  return { renders, sectionLabels, columnGaps, view, viewState, counted, stub };
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

vi.mock('@/app/reader/components/HeaderBar', () => h.counted('HeaderBar'));
vi.mock('@/app/reader/components/annotator/Annotator', () => h.counted('Annotator'));
vi.mock('@/app/reader/components/FootnotePopup', () => h.counted('FootnotePopup'));
vi.mock('@/app/reader/components/handwriting/HandwritingOverlay', () =>
  h.counted('HandwritingOverlay'),
);
vi.mock('@/app/reader/components/SectionInfo', () => ({
  default: ({ section }: { section?: string }) => {
    h.sectionLabels.push(section);
    return null;
  },
}));
vi.mock('@/app/reader/components/HintInfo', () => ({
  default: ({ columnGap }: { columnGap: number }) => {
    h.columnGaps.push(columnGap);
    return null;
  },
}));
vi.mock('@/app/reader/components/sidebar/SearchResultsNav', () => h.stub);
vi.mock('@/app/reader/components/sidebar/BooknotesNav', () => h.stub);
vi.mock('@/app/reader/components/VimCommandLine', () => h.stub);
vi.mock('@/app/reader/components/FoliateViewer', () => h.stub);
vi.mock('@/app/reader/components/PageNavigationButtons', () => h.stub);
vi.mock('@/app/reader/components/footerbar/FooterBar', () => h.stub);
vi.mock('@/app/reader/components/ProgressBar', () => h.stub);
vi.mock('@/app/reader/components/BookmarkPullDown', () => h.stub);
vi.mock('@/app/reader/components/ReadingRuler', () => h.stub);
vi.mock('@/app/reader/components/DoubleBorder', () => h.stub);
vi.mock('@/app/reader/components/ReadingStatsTracker', () => h.stub);

import BooksGrid from '@/app/reader/components/BooksGrid';
import { clearBookProgress, setBookProgress } from '@/store/readerProgressStore';
import type { BookProgress } from '@/types/book';

const turnTo = (page: number, sectionLabel: string, pages = 40) =>
  act(() => {
    setBookProgress('book-1', {
      location: `cfi-${page}`,
      sectionLabel,
      section: { current: 0, total: 3 },
      pageinfo: { current: page, total: pages },
    } as unknown as BookProgress);
  });

beforeEach(() => {
  for (const k of Object.keys(h.renders) as Array<keyof typeof h.renders>) h.renders[k] = 0;
  h.sectionLabels.length = 0;
  h.columnGaps.length = 0;
  h.view.renderer.columnCount = 1;
  clearBookProgress('book-1');
});
afterEach(cleanup);

const renderGrid = () =>
  render(<BooksGrid bookKeys={['book-1']} onCloseBook={vi.fn()} onGoToLibrary={vi.fn()} />);

describe('BooksGrid on a page turn', () => {
  it('does not re-render the page chrome for a turn within a section', () => {
    renderGrid();
    turnTo(1, 'Chapter 1');
    const before = { ...h.renders };

    turnTo(2, 'Chapter 1');
    turnTo(3, 'Chapter 1');

    expect(h.renders).toEqual(before);
  });

  it('shows the new section label after a turn into the next section', () => {
    renderGrid();
    turnTo(1, 'Chapter 1');
    turnTo(2, 'Chapter 2');

    expect(h.sectionLabels.at(-1)).toBe('Chapter 2');
  });

  it('picks up a re-layout to two columns on the next relocate', () => {
    renderGrid();
    turnTo(1, 'Chapter 1');
    expect(h.columnGaps.at(-1)).toBe(0);

    // two columns to a page halve the section's page count
    h.view.renderer.columnCount = 2;
    turnTo(1, 'Chapter 1', 20);

    expect(h.columnGaps.at(-1)).toBe(24);
  });
});
