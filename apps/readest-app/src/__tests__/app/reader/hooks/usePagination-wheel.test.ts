import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  settingsState: {
    settings: { hardwarePageTurner: undefined, reverseWheelPaging: false } as Record<
      string,
      unknown
    >,
  },
  viewSettings: { scrolled: false } as Record<string, unknown>,
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
      getViewSettings: () => h.viewSettings,
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

const setup = (layout?: string) => {
  const view = {
    renderer: { scrolled: false },
    book: { dir: 'ltr' as const, rendition: { layout } },
    next: vi.fn(),
    prev: vi.fn(),
  };
  const viewRef = { current: view as unknown as FoliateView };
  const { result } = renderHook(() => usePagination(BOOK_KEY, viewRef, { current: null }));
  const wheel = async (deltaY: number, deltaX = 0) => {
    await act(async () => {
      await result.current.handlePageFlip(
        new MessageEvent('message', {
          data: { bookKey: BOOK_KEY, type: 'iframe-wheel', deltaX, deltaY },
        }),
      );
    });
  };
  return { view, wheel };
};

beforeEach(() => {
  h.settingsState.settings = { hardwarePageTurner: undefined, reverseWheelPaging: false };
  h.viewSettings = { scrolled: false };
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

describe('usePagination mouse wheel on a fit-width PDF page (#6552)', () => {
  beforeEach(() => {
    h.viewSettings = { scrolled: false, zoomMode: 'fit-width', zoomLevel: 100 };
  });

  // useMouseEvent only forwards a vertical wheel here once the page can no
  // longer scroll natively in that direction, i.e. it sits at its edge.
  test('wheel down at the bottom edge turns to the next page', async () => {
    const { view, wheel } = setup('pre-paginated');
    await wheel(100);
    expect(view.next).toHaveBeenCalledTimes(1);
  });

  test('wheel up at the top edge turns to the previous page', async () => {
    const { view, wheel } = setup('pre-paginated');
    await wheel(-100);
    expect(view.prev).toHaveBeenCalledTimes(1);
  });

  test('reverse wheel paging does not invert the native scroll direction', async () => {
    h.settingsState.settings = { hardwarePageTurner: undefined, reverseWheelPaging: true };
    const { view, wheel } = setup('pre-paginated');
    await wheel(100);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(view.prev).not.toHaveBeenCalled();
  });

  test('a horizontal wheel still only pans', async () => {
    const { view, wheel } = setup('pre-paginated');
    await wheel(0, 100);
    expect(view.next).not.toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
  });
});
