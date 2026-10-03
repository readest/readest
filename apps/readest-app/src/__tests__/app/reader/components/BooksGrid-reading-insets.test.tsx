import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reading page keeps the side insets recorded with the status bar hidden,
 * so showing the toolbar (and iPhone Duo's side strip) does not re-paginate
 * (#6307). Only the Duo has a strip with an inset of its own: every other
 * device lays the page out against its live insets, record or not.
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
vi.mock('@/store/readerProgressStore', () => ({ useBookProgress: () => null }));
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

// The strip is an 84pt right inset while shown; the reader recorded 0 with the
// status bar hidden, at this window size.
const live = { top: 0, right: 84, bottom: 34, left: 0 };

beforeEach(() => {
  h.setGridInsets.mockClear();
  h.alwaysShowStatusBar = false;
  useThemeStore.setState({
    safeAreaInsets: live,
    statusBarHiddenInsets: {
      width: window.innerWidth,
      height: window.innerHeight,
      left: 0,
      right: 0,
    },
    isIPhoneDuo: false,
  });
});

afterEach(cleanup);

const renderGrid = () =>
  render(<BooksGrid bookKeys={['book-1']} onCloseBook={vi.fn()} onGoToLibrary={vi.fn()} />);

describe('BooksGrid reading-page insets', () => {
  it('lays the page out against the live insets off iPhone Duo, whatever was recorded', () => {
    renderGrid();
    expect(h.setGridInsets).toHaveBeenLastCalledWith('book-1', live);
  });

  it('keeps the recorded hidden-status-bar sides on iPhone Duo', () => {
    useThemeStore.setState({ isIPhoneDuo: true });
    renderGrid();
    expect(h.setGridInsets).toHaveBeenLastCalledWith('book-1', { ...live, right: 0 });
  });

  it('follows the live insets on iPhone Duo with Always Show Status Bar on', () => {
    useThemeStore.setState({ isIPhoneDuo: true });
    h.alwaysShowStatusBar = true;
    renderGrid();
    expect(h.setGridInsets).toHaveBeenLastCalledWith('book-1', live);
  });
});
