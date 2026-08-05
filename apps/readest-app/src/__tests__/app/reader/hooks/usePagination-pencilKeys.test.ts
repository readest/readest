import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { HardwarePageTurnerSettings } from '@/types/settings';

// Real deviceStore + eventDispatcher; only the native bridge boundary is
// mocked so we can observe the interceptKeys calls (#5501 pencil gestures
// must not claim media-key interception).
const h = vi.hoisted(() => ({
  appService: { isMobileApp: true } as { isMobileApp: boolean },
  viewSettings: { volumeKeysToFlip: false } as Record<string, unknown> | null,
  viewState: { inited: true } as Record<string, unknown> | null,
  settingsState: {
    settings: { hardwarePageTurner: undefined as HardwarePageTurnerSettings | undefined },
  },
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
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

import { interceptKeys } from '@/utils/bridge';
import { eventDispatcher } from '@/utils/event';
import { useDeviceControlStore } from '@/store/deviceStore';
import { usePagination } from '@/app/reader/hooks/usePagination';
import type { FoliateView } from '@/types/view';

const BOOK_KEY = 'book-1';

const PENCIL_TURNER: HardwarePageTurnerSettings = {
  enabled: true,
  bindings: {
    pagePrev: { source: 'native', id: 'PencilSqueeze', label: 'Pencil Squeeze' },
    pageNext: { source: 'native', id: 'PencilDoubleTap', label: 'Pencil Double Tap' },
    sectionPrev: null,
    sectionNext: null,
    refresh: null,
  },
};

const MEDIA_TURNER: HardwarePageTurnerSettings = {
  enabled: true,
  bindings: {
    pagePrev: { source: 'native', id: 'MediaPrevious', label: 'Media Previous' },
    pageNext: { source: 'native', id: 'MediaNext', label: 'Media Next' },
    sectionPrev: null,
    sectionNext: null,
    refresh: null,
  },
};

const makeView = () => ({
  renderer: { scrolled: false },
  book: { dir: 'ltr' as const },
  next: vi.fn(),
  prev: vi.fn(),
});

const setupWithView = (view: ReturnType<typeof makeView> | null = null) => {
  const viewRef = { current: view as unknown as FoliateView | null };
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
  delete window.onNativeKeyDown;
  h.appService = { isMobileApp: true };
  h.viewSettings = { volumeKeysToFlip: false };
  h.viewState = { inited: true };
  h.settingsState.settings.hardwarePageTurner = undefined;
});

afterEach(() => {
  cleanup();
});

describe('usePagination Apple Pencil bindings (#5501)', () => {
  test('a bound pencil double tap turns to the next page', async () => {
    h.settingsState.settings.hardwarePageTurner = PENCIL_TURNER;
    const view = makeView();
    setupWithView(view);

    await pressNativeKey('PencilDoubleTap');

    expect(view.next).toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
  });

  test('a bound pencil squeeze turns to the previous page', async () => {
    h.settingsState.settings.hardwarePageTurner = PENCIL_TURNER;
    const view = makeView();
    setupWithView(view);

    await pressNativeKey('PencilSqueeze');

    expect(view.prev).toHaveBeenCalled();
  });

  test('pencil-only bindings install forwarding but never media-key interception', () => {
    h.settingsState.settings.hardwarePageTurner = PENCIL_TURNER;
    setupWithView();

    expect(window.onNativeKeyDown).toBeDefined();
    expect(interceptKeys).not.toHaveBeenCalledWith(
      expect.objectContaining({ pageTurnerKeys: true }),
    );
  });

  test('media-key bindings still acquire native interception', () => {
    h.settingsState.settings.hardwarePageTurner = MEDIA_TURNER;
    setupWithView();

    expect(interceptKeys).toHaveBeenCalledWith({ pageTurnerKeys: true });
  });

  test('mixed pencil and media bindings acquire interception and both keys work', async () => {
    h.settingsState.settings.hardwarePageTurner = {
      enabled: true,
      bindings: {
        pagePrev: { source: 'native', id: 'PencilSqueeze', label: 'Pencil Squeeze' },
        pageNext: { source: 'native', id: 'MediaNext', label: 'Media Next' },
        sectionPrev: null,
        sectionNext: null,
        refresh: null,
      },
    };
    const view = makeView();
    setupWithView(view);

    expect(interceptKeys).toHaveBeenCalledWith({ pageTurnerKeys: true });
    await pressNativeKey('PencilSqueeze');
    expect(view.prev).toHaveBeenCalled();
    await pressNativeKey('MediaNext');
    expect(view.next).toHaveBeenCalled();
  });
});
