// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The reader page renders the whole reader under it, so it re-renders only for what it shows.
 * Opening a book updates its view state and the sidebar's book several times; when the page
 * subscribed to those whole stores, each update re-rendered ~175 components, which on an e-ink
 * reader (Readest Lite, QuickJS) cost seconds while the book opened.
 */

const h = vi.hoisted(() => ({ contentRenders: 0, isAndroidApp: false, back: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ back: h.back }) }));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { isMobileApp: false, isIOSApp: false, isAndroidApp: h.isAndroidApp },
  }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ onUpdateInsets: vi.fn() }) }));
vi.mock('@/hooks/useLibrary', () => ({ useLibrary: () => ({ libraryLoaded: true }) }));
vi.mock('@/hooks/useScreenWakeLock', () => ({ useScreenWakeLock: vi.fn() }));
vi.mock('@/app/reader/hooks/useScreenBrightness', () => ({ useScreenBrightness: vi.fn() }));
vi.mock('@/hooks/useTransferQueue', () => ({ useTransferQueue: vi.fn() }));
vi.mock('@/hooks/useReplicaPull', () => ({ useReplicaPull: vi.fn() }));
vi.mock('@/store/settingsStore', async () => {
  const { create } = await import('zustand');
  return {
    useSettingsStore: create(() => ({
      settings: { alwaysShowStatusBar: false, globalReadSettings: {} },
      isFontLayoutSettingsDialogOpen: false,
    })),
  };
});
vi.mock('@/store/readerStore', async () => {
  const { create } = await import('zustand');
  const store = create<{
    hoveredBookKey: string;
    viewStates: Record<string, unknown>;
    setHoveredBookKey: (key: string) => void;
  }>((set) => ({
    hoveredBookKey: '',
    viewStates: {},
    setHoveredBookKey: (hoveredBookKey) => set({ hoveredBookKey }),
  }));
  return { useReaderStore: store };
});
vi.mock('@/store/deviceStore', async () => {
  const { create } = await import('zustand');
  return {
    useDeviceControlStore: create(() => ({
      acquireBackKeyInterception: vi.fn(),
      releaseBackKeyInterception: vi.fn(),
    })),
  };
});
vi.mock('@/styles/fonts', () => ({ mountAdditionalFonts: vi.fn() }));
vi.mock('@/utils/open', () => ({ interceptWindowOpen: vi.fn() }));
vi.mock('@/utils/time', () => ({ initDayjs: vi.fn() }));
vi.mock('@/services/environment', () => ({ isTauriAppPlatform: () => false }));
vi.mock('@/utils/bridge', () => ({ getSysFontsList: vi.fn(), setSystemUIVisibility: vi.fn() }));
vi.mock('@/components/AboutWindow', () => ({ AboutWindow: () => null }));
vi.mock('@/components/KeyboardShortcutsHelp', () => ({ KeyboardShortcutsHelp: () => null }));
vi.mock('@/components/UpdaterWindow', () => ({ UpdaterWindow: () => null }));
vi.mock('@/components/Toast', () => ({ Toast: () => null }));
vi.mock('@/components/stats/ReadingStatsDialog', () => ({ default: () => null }));
vi.mock('@/components/vocabulary/VocabularyDialog', () => ({ VocabularyDialog: () => null }));
vi.mock('@/app/reader/components/ProofreadRules', () => ({ ProofreadRulesManager: () => null }));
vi.mock('@/app/reader/components/ReaderContent', () => ({
  default: () => {
    h.contentRenders++;
    return null;
  },
}));

import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useNotebookStore } from '@/store/notebookStore';
import { eventDispatcher } from '@/utils/event';
import Reader from '@/app/reader/components/Reader';

beforeEach(() => {
  h.contentRenders = 0;
  h.isAndroidApp = false;
  h.back.mockClear();
  useSidebarStore.setState({
    sideBarBookKey: null,
    isSideBarVisible: false,
    isSideBarPinned: false,
  });
  useNotebookStore.setState({ isNotebookVisible: false, isNotebookPinned: false });
});

afterEach(cleanup);

// The mocked store keeps only what Reader reads; a view state here is just something that changes.
const viewStates = (loading: boolean) =>
  ({ 'book-1': { loading } }) as unknown as ReturnType<
    typeof useReaderStore.getState
  >['viewStates'];

describe('Reader page re-renders', () => {
  it('does not re-render the reader when a book opens', async () => {
    render(<Reader ids='book' />);
    await act(async () => {});
    const before = h.contentRenders;
    expect(before).toBeGreaterThan(0);
    act(() => useReaderStore.setState({ viewStates: viewStates(true) }));
    act(() => useSidebarStore.setState({ sideBarBookKey: 'book-1' }));
    act(() => useReaderStore.setState({ viewStates: viewStates(false) }));
    act(() => useNotebookStore.setState({ isNotebookPinned: true }));
    expect(h.contentRenders).toBe(before);
  });

  it('closes a sidebar opened after the page mounted with Back on Android', async () => {
    h.isAndroidApp = true;
    render(<Reader ids='book' />);
    await act(async () => {});
    act(() => useSidebarStore.setState({ isSideBarVisible: true }));
    act(() => {
      eventDispatcher.dispatchSync('native-key-down', { keyName: 'Back' });
    });
    expect(useSidebarStore.getState().isSideBarVisible).toBe(false);
    expect(h.back).not.toHaveBeenCalled();
  });
});
