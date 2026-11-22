// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Two books share the screen at a split the reader drags (#4991): one book can
 * be made wider than the other.
 */

const h = vi.hoisted(() => ({
  setGridInsets: vi.fn(),
  alwaysShowStatusBar: false,
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: (select: (state: { settings: { alwaysShowStatusBar: boolean } }) => unknown) =>
    select({ settings: { alwaysShowStatusBar: h.alwaysShowStatusBar } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({
      hoveredBookKey: null,
      setGridInsets: h.setGridInsets,
      viewStates: {},
      getView: () => null,
    }),
}));
vi.mock('@/store/readerProgressStore', () => ({
  useReaderProgressStore: (select: (state: { progresses: object }) => unknown) =>
    select({ progresses: {} }),
}));
vi.mock('@/store/sidebarStore', () => ({ useSidebarStore: () => null }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: (select: (state: Record<string, unknown>) => unknown) =>
    select({ getConfig: () => null, getBookData: () => null }),
}));
vi.mock('@/utils/window', () => ({ tauriSetWindowTitle: vi.fn() }));
vi.mock('@/app/reader/hooks/useContentInsets', () => ({ useContentInsets: () => ({}) }));
vi.mock('@/app/reader/components/sidebar/SearchResultsNav', () => ({ default: () => null }));
vi.mock('@/app/reader/components/sidebar/BooknotesNav', () => ({ default: () => null }));
vi.mock('@/app/reader/components/FoliateViewer', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SectionInfo', () => ({ default: () => null }));
vi.mock('@/app/reader/components/HeaderBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/PageNavigationButtons', () => ({ default: () => null }));
vi.mock('@/app/reader/components/footerbar/FooterBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ProgressBar', () => ({ default: () => null }));
vi.mock('@/app/reader/components/BookmarkPullDown', () => ({ default: () => null }));
vi.mock('@/app/reader/components/annotator/Annotator', () => ({ default: () => null }));
vi.mock('@/app/reader/components/FootnotePopup', () => ({ default: () => null }));
vi.mock('@/app/reader/components/HintInfo', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ReadingRuler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/DoubleBorder', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ReadingStatsTracker', () => ({ default: () => null }));

import { useThemeStore } from '@/store/themeStore';
import BooksGrid from '@/app/reader/components/BooksGrid';

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

const setWindowSize = (width: number, height: number) => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
};

// The grid sits right of a 200px sidebar.
const gridRect = { left: 200, top: 0, right: 1200, bottom: 800, width: 1000, height: 800 };

beforeEach(() => {
  setWindowSize(1200, 800);
  useThemeStore.setState({ safeAreaInsets: insets, isIPhoneDuo: false });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const rect = this.classList.contains('books-grid') ? gridRect : { ...gridRect, width: 0 };
    return { ...rect, x: rect.left, y: rect.top, toJSON: () => rect } as DOMRect;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.style.direction = '';
});

const renderGrid = (bookKeys = ['book-1', 'book-2']) =>
  render(<BooksGrid bookKeys={bookKeys} onCloseBook={vi.fn()} onGoToLibrary={vi.fn()} />);

const grid = () => document.querySelector<HTMLElement>('.books-grid')!;
const divider = () => screen.getByRole('slider', { name: 'Resize Books' });

// The seam of an even split is at x 700 (side by side) or y 400 (stacked).
const drag = (
  to: { clientX?: number; clientY?: number },
  from: { clientX?: number; clientY?: number } = {},
) => {
  fireEvent.mouseDown(divider(), { clientX: 700, clientY: 400, ...from });
  act(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 0, clientY: 0, ...to }));
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 0, clientY: 0, ...to }));
  });
};

describe('BooksGrid divider between two books', () => {
  it('splits two books evenly until the divider moves', () => {
    renderGrid();
    expect(grid().style.gridTemplateColumns).toBe('1fr 1fr');
    expect(divider().getAttribute('aria-valuenow')).toBe('50');
  });

  it('gives the left book the width left of where the divider is dropped', () => {
    renderGrid();
    drag({ clientX: 500 });
    expect(grid().style.gridTemplateColumns).toBe('minmax(0, 30fr) minmax(0, 70fr)');
    expect(divider().getAttribute('aria-valuenow')).toBe('30');
  });

  it('keeps each book at least a fifth of the grid', () => {
    renderGrid();
    drag({ clientX: 210 });
    expect(grid().style.gridTemplateColumns).toBe('minmax(0, 20fr) minmax(0, 80fr)');
    drag({ clientX: 1190 }, { clientX: 400 });
    expect(grid().style.gridTemplateColumns).toBe('minmax(0, 80fr) minmax(0, 20fr)');
  });

  // The hit area is 32px wide: a press off the seam must not jump it to the pointer.
  it('keeps the divider where it was grabbed', () => {
    renderGrid();
    drag({ clientX: 717 }, { clientX: 716 });
    expect(grid().style.gridTemplateColumns).toBe('minmax(0, 50fr) minmax(0, 50fr)');
    expect(divider().getAttribute('aria-valuenow')).toBe('50');
  });

  it('measures from the right when the first book is on the right (RTL)', () => {
    document.documentElement.style.direction = 'rtl';
    renderGrid();
    drag({ clientX: 500 });
    expect(grid().style.gridTemplateColumns).toBe('minmax(0, 70fr) minmax(0, 30fr)');
  });

  it('moves with the arrow keys', () => {
    renderGrid();
    fireEvent.keyDown(divider(), { key: 'ArrowRight' });
    expect(grid().style.gridTemplateColumns).toBe('minmax(0, 52fr) minmax(0, 48fr)');
  });

  it('splits the height when the books are stacked', () => {
    setWindowSize(800, 1200);
    renderGrid();
    drag({ clientY: 200 });
    expect(grid().style.gridTemplateColumns).toBe('1fr');
    expect(grid().style.gridTemplateRows).toBe('minmax(0, 25fr) minmax(0, 75fr)');
    expect(divider().getAttribute('aria-orientation')).toBe('vertical');
  });

  it('has no divider for a single book', () => {
    renderGrid(['book-1']);
    expect(screen.queryByRole('slider', { name: 'Resize Books' })).toBeNull();
  });
});
