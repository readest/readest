import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

// Real deviceStore + eventDispatcher; only the native bridge boundary is mocked
// so we can observe the interceptKeys({ volumeKeys }) calls the store makes.
const h = vi.hoisted(() => ({
  appService: { isMobileApp: true } as { isMobileApp: boolean },
  viewSettings: { volumeKeysToFlip: true } as Record<string, unknown> | null,
  viewState: { inited: true } as Record<string, unknown> | null,
  settingsState: { settings: { hardwarePageTurner: undefined } },
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

const setup = () => {
  const viewRef = { current: null };
  const containerRef = { current: null };
  return renderHook(() => usePagination(BOOK_KEY, viewRef, containerRef));
};

const makeView = () => ({
  renderer: { scrolled: false },
  book: { dir: 'ltr' as const },
  next: vi.fn(),
  prev: vi.fn(),
});

const setupWithView = (view: ReturnType<typeof makeView>) => {
  const viewRef = { current: view as unknown as FoliateView };
  const containerRef = { current: null };
  return renderHook(() => usePagination(BOOK_KEY, viewRef, containerRef));
};

const pressVolumeKey = async (keyName: 'VolumeUp' | 'VolumeDown') => {
  await act(async () => {
    await eventDispatcher.dispatch('native-key-down', { keyName });
  });
};

const emitPlayback = async (state: string, bookKey = BOOK_KEY) => {
  await act(async () => {
    await eventDispatcher.dispatch('tts-playback-state', { bookKey, state });
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
  h.appService = { isMobileApp: true };
  h.viewSettings = { volumeKeysToFlip: true };
  h.viewState = { inited: true };
});

afterEach(() => {
  cleanup();
});

describe('usePagination volume-key interception with TTS (#4691)', () => {
  test('intercepts volume keys on mount when the setting is on and TTS is idle', () => {
    setup();
    expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: true });
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(true);
  });

  test('hands volume keys back to the OS while TTS is playing', async () => {
    setup();
    vi.mocked(interceptKeys).mockClear();

    await emitPlayback('playing');

    expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: false });
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(false);
  });

  test('restores interception when TTS is paused', async () => {
    setup();
    await emitPlayback('playing');
    vi.mocked(interceptKeys).mockClear();

    await emitPlayback('paused');

    expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: true });
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(true);
  });

  test('restores interception when TTS is stopped', async () => {
    setup();
    await emitPlayback('playing');
    vi.mocked(interceptKeys).mockClear();

    await emitPlayback('stopped');

    expect(interceptKeys).toHaveBeenCalledWith({ volumeKeys: true });
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(true);
  });

  test('ignores TTS playback state from a different book', async () => {
    setup();
    vi.mocked(interceptKeys).mockClear();

    await emitPlayback('playing', 'other-book');

    expect(interceptKeys).not.toHaveBeenCalledWith({ volumeKeys: false });
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(true);
  });

  test('does not intercept volume keys when the setting is off', () => {
    h.viewSettings = { volumeKeysToFlip: false };
    setup();
    expect(interceptKeys).not.toHaveBeenCalledWith({ volumeKeys: true });
    expect(useDeviceControlStore.getState().volumeKeysIntercepted).toBe(false);
  });

  // The native side still forwards volume keys to the web layer while TTS plays
  // (iOS via a lingering KVO, Android calls onNativeKeyDown unconditionally), so
  // handlePageFlip must itself refuse to page-flip while TTS is playing — the
  // key should fall through to controlling the volume instead.
  test('does not page-flip on volume keys while TTS is playing', async () => {
    const view = makeView();
    setupWithView(view);
    await emitPlayback('playing');

    await pressVolumeKey('VolumeUp');
    await pressVolumeKey('VolumeDown');

    expect(view.prev).not.toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });

  test('page-flips on volume keys when TTS is paused', async () => {
    const view = makeView();
    setupWithView(view);
    await emitPlayback('playing');
    await emitPlayback('paused');

    await pressVolumeKey('VolumeDown');

    expect(view.next).toHaveBeenCalled();
  });

  test('page-flips on volume keys when TTS is idle', async () => {
    const view = makeView();
    setupWithView(view);

    await pressVolumeKey('VolumeUp');

    expect(view.prev).toHaveBeenCalled();
  });
});
