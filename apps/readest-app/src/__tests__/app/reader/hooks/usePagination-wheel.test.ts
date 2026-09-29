import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  settingsState: {
    settings: { hardwarePageTurner: undefined, reverseWheelPaging: false } as Record<
      string,
      unknown
    >,
  },
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobileApp: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: () => ({ scrolled: false }),
      getViewState: () => ({ inited: true }),
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

import { usePagination } from '@/app/reader/hooks/usePagination';
import type { FoliateView } from '@/types/view';

const BOOK_KEY = 'book-1';

const setup = () => {
  const view = {
    renderer: { scrolled: false },
    book: { dir: 'ltr' as const, rendition: {} },
    next: vi.fn(),
    prev: vi.fn(),
  };
  const viewRef = { current: view as unknown as FoliateView };
  const { result } = renderHook(() => usePagination(BOOK_KEY, viewRef, { current: null }));
  const wheel = async (deltaY: number) => {
    await act(async () => {
      await result.current.handlePageFlip(
        new MessageEvent('message', {
          data: { bookKey: BOOK_KEY, type: 'iframe-wheel', deltaX: 0, deltaY },
        }),
      );
    });
  };
  return { view, wheel };
};

beforeEach(() => {
  h.settingsState.settings = { hardwarePageTurner: undefined, reverseWheelPaging: false };
});

afterEach(() => {
  cleanup();
});

describe('usePagination mouse wheel direction (#6439)', () => {
  test('wheel down turns to the next page by default', async () => {
    const { view, wheel } = setup();
    await wheel(100);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(view.prev).not.toHaveBeenCalled();
  });

  test('wheel down turns to the previous page when reversed', async () => {
    h.settingsState.settings = { hardwarePageTurner: undefined, reverseWheelPaging: true };
    const { view, wheel } = setup();
    await wheel(100);
    expect(view.prev).toHaveBeenCalledTimes(1);
    expect(view.next).not.toHaveBeenCalled();
  });

  test('wheel up turns to the next page when reversed', async () => {
    h.settingsState.settings = { hardwarePageTurner: undefined, reverseWheelPaging: true };
    const { view, wheel } = setup();
    await wheel(-100);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(view.prev).not.toHaveBeenCalled();
  });
});
