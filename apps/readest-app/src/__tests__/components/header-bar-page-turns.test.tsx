import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { create, type StoreApi } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import HeaderBar from '@/app/reader/components/HeaderBar';

// The header is hidden while reading. A page turn writes the book's progress
// into bookDataStore and re-renders the book's cell, and a progress save
// writes it again; none of that is shown in the header, yet each one
// re-rendered it and all its buttons (on the Kindle, CPU on every turn).

const counts = vi.hoisted(() => ({ renders: 0, tools: 0 }));
// A store hook called with a selector, or without one for the whole state.
const { storeHook } = vi.hoisted(() => ({
  storeHook:
    <T extends object>(state: T) =>
    (select?: (s: T) => unknown) =>
      select ? select(state) : state,
}));

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (key: string) => key }));
vi.mock('@/context/EnvContext', () => {
  const env = { envConfig: {}, appService: { isMobile: true } };
  return { useEnv: () => env };
});
vi.mock('@/store/settingsStore', () => {
  const state = {
    settings: { globalReadSettings: { highlightStyle: 'highlight', highlightStyles: {} } },
  };
  return { useSettingsStore: storeHook(state) };
});
vi.mock('@/store/themeStore', () => {
  const state = {
    isDarkMode: false,
    systemUIVisible: true,
    statusBarHeight: 0,
    isIPhoneDuo: false,
  };
  return { useThemeStore: storeHook(state) };
});
vi.mock('@/store/sidebarStore', () => {
  const state = { isSideBarVisible: false, getIsSideBarVisible: () => false };
  return { useSidebarStore: storeHook(state) };
});
vi.mock('@/store/readerStore', () => {
  const viewSettings = { enableAnnotationQuickActions: false };
  const useReaderStore = create(() => ({
    bookKeys: ['book-1'],
    hoveredBookKey: '',
    viewStates: {
      'book-1': { key: 'book-1', gridInsets: null, inited: false, viewSettings },
    } as Record<string, object>,
    getView: () => null,
    getViewSettings: () => viewSettings,
    setHoveredBookKey: () => {},
  }));
  return { useReaderStore };
});
vi.mock('@/store/bookDataStore', () => {
  type Data = { book: { title: string; metadata: { series?: string } }; config: object };
  const useBookDataStore = create(() => ({
    data: { book: { title: 'Book', metadata: {} }, config: { location: 'a' } } as Data,
    getBookData: () => useBookDataStore.getState().data,
    getConfig: () => useBookDataStore.getState().data.config,
  }));
  // as the real hooks: the book's data without its config, and the config
  // without the progress and location a page turn writes, compared shallowly
  const useBookData = () => useBookDataStore(useShallow((s) => ({ book: s.data.book })));
  const useBookConfig = () =>
    useBookDataStore(
      useShallow((s) => {
        const { progress: _p, location: _l, ...rest } = s.data.config as Record<string, unknown>;
        return rest;
      }),
    );
  return { useBookDataStore, useBookData, useBookConfig };
});
vi.mock('@/store/trafficLightStore', () => {
  const state = { trafficLightInFullscreen: false, setTrafficLightVisibility: () => {} };
  return { useTrafficLightStore: () => state };
});
vi.mock('@/hooks/useTrafficLight', () => ({
  useTrafficLight: () => ({ isTrafficLightVisible: false }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: () => {} }));
vi.mock('@/utils/insets', () => ({
  getHeaderTriggerHeight: () => 0,
  getHorizontalInsetStyle: () => ({}),
}));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({
  default: () => {
    counts.renders++;
    return null;
  },
}));
vi.mock('@/app/reader/components/SidebarToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/NotebookToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({
  default: () => {
    counts.tools++;
    return null;
  },
}));
vi.mock('@/app/reader/components/DuoBookModeToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));

type Data = { book: { title: string; metadata: { series?: string } }; config: object };
// The mocked store, typed as the test's own (the real module's type differs).
const { useBookDataStore } = (await import('@/store/bookDataStore')) as unknown as {
  useBookDataStore: StoreApi<{ data: Data }>;
};
const { useReaderStore } = (await import('@/store/readerStore')) as unknown as {
  useReaderStore: StoreApi<{ viewStates: Record<string, object> }>;
};
const updateViewState = (change: object) =>
  act(() =>
    useReaderStore.setState((s) => ({
      viewStates: { 'book-1': { ...s.viewStates['book-1'], ...change } },
    })),
  );

const insets = { top: 0, right: 0, bottom: 0, left: 0 };
const onCloseBook = () => {};
const onGoToLibrary = () => {};
const header = () => (
  <HeaderBar
    bookKey='book-1'
    bookTitle='Book'
    isTopLeft={false}
    isHoveredAnim={false}
    gridInsets={insets}
    screenInsets={insets}
    onCloseBook={onCloseBook}
    onGoToLibrary={onGoToLibrary}
  />
);
const writeData = (change: object) =>
  act(() => useBookDataStore.setState((s) => ({ data: { ...s.data, ...change } })));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  counts.renders = 0;
  counts.tools = 0;
  // a book whose first page is on screen
  useReaderStore.setState({
    viewStates: { 'book-1': { key: 'book-1', gridInsets: null, inited: true, viewSettings: {} } },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('HeaderBar while pages turn', () => {
  it('does not re-render for a page turn or a progress save', () => {
    const { rerender } = render(header());
    expect(counts.renders).toBeGreaterThan(0);
    counts.renders = 0;

    // a page turn: progress written into the config, and the book cell re-rendered
    writeData({ config: { location: 'b', progress: [2, 100] } });
    rerender(header());
    // the progress save that follows
    writeData({ config: { location: 'b', progress: [2, 100], updatedAt: 1 } });
    expect(counts.renders).toBe(0);

    // what the header does show still reaches it
    writeData({ book: { title: 'Book', metadata: { series: 'The Expanse' } } });
    expect(counts.renders).toBe(1);
  });

  // Opening a book sets the page area's insets, which the header doesn't show
  it('does not re-render when the page insets are set', () => {
    render(header());
    counts.renders = 0;
    updateViewState({ gridInsets: { top: 10, right: 0, bottom: 0, left: 0 } });
    expect(counts.renders).toBe(0);
  });
});

// Building the hidden header's tools was part of the work between tapping a book and seeing its
// page on an e-ink reader running QuickJS (Readest Lite)
describe('HeaderBar while a book opens', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'],
    });
    updateViewState({ inited: false });
  });

  it('builds its tools once the first page has been painted, its bookmark toggler at once', () => {
    render(header());
    expect(counts.renders).toBeGreaterThan(0);
    expect(counts.tools).toBe(0);
    expect(document.querySelector('.header-title')).toBeNull();

    // the view went to the first page; it is painted with the next frame
    updateViewState({ inited: true });
    expect(counts.tools).toBe(0);
    act(() => vi.advanceTimersToNextFrame());
    act(() => vi.runOnlyPendingTimers());
    expect(counts.tools).toBeGreaterThan(0);
    expect(document.querySelector('.header-title')).not.toBeNull();
  });
});
