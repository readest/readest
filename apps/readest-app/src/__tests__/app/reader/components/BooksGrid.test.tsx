import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import BooksGrid from '@/app/reader/components/BooksGrid';
import { DEFAULT_BOOK_LAYOUT, DEFAULT_VIEW_CONFIG } from '@/services/constants';

const viewSettings = {
  ...DEFAULT_BOOK_LAYOUT,
  ...DEFAULT_VIEW_CONFIG,
};

const viewState = { viewerKey: 'viewer-1', inited: true, viewSettings };

const bookData = {
  book: { title: 'Dune', format: 'PDF' },
  bookDoc: { toc: [], metadata: { language: 'en' }, rendition: { layout: 'pre-paginated' } },
  isFixedLayout: true,
};

const readerState = {
  hoveredBookKey: '',
  setGridInsets: vi.fn(),
  viewStates: { 'book-1': viewState },
};

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { hasRoundedWindow: false, hasWindow: false } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: <R,>(selector?: (s: typeof readerState) => R) =>
    selector ? selector(readerState) : readerState,
}));

vi.mock('@/store/bookDataStore', () => {
  const state = { getBookData: () => bookData, getConfig: () => ({}) };
  return {
    useBookDataStore: <R,>(selector?: (s: typeof state) => R) =>
      selector ? selector(state) : state,
  };
});

// The cell's children are irrelevant to how the cell itself composites.
// Factories are inlined because vi.mock is hoisted above module-scope consts.
vi.mock('@/app/reader/components/FoliateViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SectionInfo', () => ({ default: () => null }));
vi.mock('@/app/reader/components/HeaderBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/PageNavigationButtons', () => ({ default: () => null }));
vi.mock('@/app/reader/components/footerbar/FooterBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ProgressBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/Annotator', () => ({ default: () => null }));
vi.mock('@/app/reader/components/FootnotePopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ReadingStatsTracker', () => ({ default: () => null }));

describe('BooksGrid', () => {
  it('isolates the cell so the fixed-layout blends do not promote html to a composited layer', () => {
    // Drop `isolate` and the fixed-layout blends promote <html> to a composited
    // layer, which WebKitGTK mispaints as a black corner (#5609). See BooksGrid.tsx.
    const { container } = render(
      <BooksGrid bookKeys={['book-1']} onCloseBook={vi.fn()} onGoToLibrary={vi.fn()} />,
    );
    const cell = container.querySelector('#gridcell-book-1') as HTMLElement;

    expect(cell).not.toBeNull();
    expect(cell.classList.contains('isolate')).toBe(true);
  });
});
