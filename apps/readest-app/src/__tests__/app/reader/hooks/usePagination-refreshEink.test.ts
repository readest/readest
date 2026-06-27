import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { HardwarePageTurnerSettings } from '@/types/settings';

// Real eventDispatcher; only the native bridge boundary is mocked so we can
// observe whether the "Refresh Page" page-turner action drives a native
// e-ink refresh.
const REFRESH_BINDING = {
  source: 'native' as const,
  id: 'MediaPlayPause',
  label: 'Media Play/Pause',
};

const hardwarePageTurner: HardwarePageTurnerSettings = {
  enabled: true,
  bindings: {
    pagePrev: null,
    pageNext: null,
    sectionPrev: null,
    sectionNext: null,
    refresh: REFRESH_BINDING,
  },
};

const h = vi.hoisted(() => ({
  appService: { isMobileApp: true, isAndroidApp: true } as {
    isMobileApp: boolean;
    isAndroidApp: boolean;
  },
  viewSettings: {} as Record<string, unknown> | null,
  viewState: { inited: true } as Record<string, unknown> | null,
  settingsState: { settings: { hardwarePageTurner: undefined as unknown } },
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
  refreshEinkScreen: vi.fn(() => Promise.resolve({ success: true })),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: h.appService }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: () => h.viewSettings,
      getViewState: () => h.viewState,
      hoveredBookKey: null,
      setHoveredBookKey: vi.fn(),
    }),
    { getState: () => ({ hoveredBookKey: null }) },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({}) }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: typeof h.settingsState) => unknown) =>
      selector ? selector(h.settingsState) : h.settingsState,
    { getState: () => h.settingsState },
  ),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(() => ({}), { getState: () => ({ sideBarBookKey: 'book-1' }) }),
}));

import { refreshEinkScreen } from '@/utils/bridge';
import { eventDispatcher } from '@/utils/event';
import { useDeviceControlStore } from '@/store/deviceStore';
import { usePagination } from '@/app/reader/hooks/usePagination';

const BOOK_KEY = 'book-1';

const setup = () => {
  const viewRef = { current: null };
  const containerRef = { current: null };
  return renderHook(() => usePagination(BOOK_KEY, viewRef, containerRef));
};

const pressNativeKey = async (keyName: string) => {
  await act(async () => {
    await eventDispatcher.dispatch('native-key-down', { keyName });
  });
};

beforeEach(() => {
  useDeviceControlStore.setState({
    volumeKeysIntercepted: false,
    volumeKeysInterceptionCount: 0,
    pageTurnerKeysIntercepted: false,
    pageTurnerKeysInterceptionCount: 0,
  });
  vi.clearAllMocks();
  h.appService = { isMobileApp: true, isAndroidApp: true };
  h.viewSettings = {};
  h.viewState = { inited: true };
  h.settingsState = { settings: { hardwarePageTurner } };
});

afterEach(() => {
  cleanup();
});

describe('usePagination "Refresh Page" action (#4687)', () => {
  test('triggers a native e-ink refresh for the bound key on Android', async () => {
    setup();
    await pressNativeKey('MediaPlayPause');
    expect(refreshEinkScreen).toHaveBeenCalledTimes(1);
  });

  test('does not call the bridge for an unrelated key', async () => {
    setup();
    await pressNativeKey('MediaFastForward');
    expect(refreshEinkScreen).not.toHaveBeenCalled();
  });

  test('does not call the bridge off Android even if the key is bound', async () => {
    h.appService = { isMobileApp: true, isAndroidApp: false };
    setup();
    await pressNativeKey('MediaPlayPause');
    expect(refreshEinkScreen).not.toHaveBeenCalled();
  });
});
