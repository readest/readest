import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef } from 'react';

import HeaderBar from '@/app/reader/components/HeaderBar';
import { useTrafficLight } from '@/hooks/useTrafficLight';
import { useTrafficLightStore } from '@/store/trafficLightStore';

// jsdom ships no ResizeObserver, and both HeaderBar and useTrafficLight
// construct one. `observe()` is a no-op here: the traffic-light hook falls
// back to the store's standard h-11 height when the observer never fires,
// which is all this test needs.
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// The store reaches the window API through `await import('@tauri-apps/api/window')`,
// so stub the IPC bridge it talks to rather than the module: the app is windowed,
// never fullscreen, and its fullscreen listeners never fire.
(globalThis as unknown as Record<string, unknown>)['__TAURI_INTERNALS__'] = {
  metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  invoke: async (cmd: string) => (cmd === 'plugin:window|is_fullscreen' ? false : 0),
  transformCallback: () => 0,
  convertFileSrc: (src: string) => src,
};
(globalThis as unknown as Record<string, unknown>)['__TAURI_EVENT_PLUGIN_INTERNALS__'] = {
  unregisterListener: () => {},
};

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (key: string) => key,
}));

const appService = { isMobile: false, hasTrafficLight: true, hasWindowBar: false };
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ envConfig: {}, appService }),
}));

vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: () => ({
    settings: { globalReadSettings: { highlightStyle: 'highlight', highlightStyles: {} } },
  }),
}));
vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false, systemUIVisible: true, statusBarHeight: 0 }),
}));
// The reader is showing a single book with the sidebar closed — the state in
// which HeaderBar owns the traffic lights and hides them when unhovered.
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: () => ({ isSideBarVisible: false, getIsSideBarVisible: () => false }),
}));

// `null` is what WindowButtons' close handler writes before it closes the last
// book and routes back to the library.
let hoveredBookKey: string | null = null;
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({
    bookKeys: ['book-1'],
    hoveredBookKey,
    getView: () => null,
    getViewSettings: () => ({ enableAnnotationQuickActions: false }),
    setHoveredBookKey: vi.fn(),
  }),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => null, getConfig: () => null }),
}));
vi.mock('@/hooks/useResponsiveSize', () => ({ useResponsiveSize: (n: number) => n }));
vi.mock('@/app/reader/hooks/useSpatialNavigation', () => ({ useSpatialNavigation: () => {} }));
vi.mock('@/utils/insets', () => ({ getHeaderTriggerHeight: () => 0 }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: vi.fn() }));
vi.mock('@/app/reader/components/SidebarToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/BookmarkToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/NotebookToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/TranslationToggler', () => ({ default: () => null }));
vi.mock('@/app/reader/components/ViewMenu', () => ({ default: () => null }));
vi.mock('@/app/reader/components/SyncInfoDialog', () => ({ default: () => null }));
vi.mock('@/components/WindowButtons', () => ({ default: () => null }));
vi.mock('@/components/Dropdown', () => ({ default: () => null }));
vi.mock('@/components/ModalPortal', () => ({ default: () => null }));

const insets = { top: 0, right: 0, bottom: 0, left: 0 };

const renderReaderHeader = () =>
  render(
    <HeaderBar
      bookKey='book-1'
      bookTitle='Book'
      isTopLeft={true}
      isHoveredAnim={false}
      gridInsets={insets}
      screenInsets={insets}
      onCloseBook={vi.fn()}
      onGoToLibrary={vi.fn()}
    />,
  );

// Stands in for LibraryHeader, which drives the traffic lights through the
// same hook. Rendering the real header would pull in the whole library page's
// menu tree without changing what is under test.
const LibraryHeaderStandIn = () => {
  const headerRef = useRef<HTMLDivElement>(null);
  useTrafficLight(headerRef);
  return <div ref={headerRef} />;
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', MockResizeObserver);
  hoveredBookKey = null;
  mockInvoke.mockClear();
  useTrafficLightStore.setState({
    isTrafficLightVisible: false,
    shouldShowTrafficLight: false,
    trafficLightInFullscreen: false,
    headerHeight: 44,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('traffic lights when the reader hands the window back to the library', () => {
  it('keeps them shown on the library page in a windowed (non-fullscreen) app', async () => {
    // Reader, sidebar closed, header unhovered: the header schedules its
    // deferred hide.
    renderReaderHeader().unmount();

    // Navigation lands on the library, which always wants them shown.
    render(<LibraryHeaderStandIn />);

    // The reader's deferred hide comes due after the library is up.
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(useTrafficLightStore.getState().isTrafficLightVisible).toBe(true);
    expect(mockInvoke).toHaveBeenLastCalledWith('set_traffic_lights', {
      visible: true,
      headerHeight: 44,
    });
  });
});
