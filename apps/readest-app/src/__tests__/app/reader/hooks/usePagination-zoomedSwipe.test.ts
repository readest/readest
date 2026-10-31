import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  viewSettings: {} as Record<string, unknown>,
  setViewSettings: vi.fn(),
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
}));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
}));
vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobileApp: true } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: () => h.viewSettings,
      getViewState: () => ({ inited: true }),
      hoveredBookKey: null,
      setHoveredBookKey: vi.fn(),
    }),
    {
      getState: () => ({
        hoveredBookKey: null,
        getViewSettings: () => h.viewSettings,
        setViewSettings: h.setViewSettings,
      }),
    },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({ isFixedLayout: true }) }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (selector?: (s: { settings: Record<string, unknown> }) => unknown) => {
      const state = { settings: {} };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ settings: {} }) },
  ),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(() => ({}), { getState: () => ({ sideBarBookKey: 'book-1' }) }),
}));

import { usePagination } from '@/app/reader/hooks/usePagination';
import {
  dispatchTouchInterceptors,
  type TouchDetail,
} from '@/app/reader/hooks/useTouchInterceptor';
import type { FoliateView } from '@/types/view';

const BOOK_KEY = 'book-1';

const setup = (panX: number | null) => {
  const view = {
    renderer: { scrolled: false, panX, getAttribute: () => null, setAttribute: vi.fn() },
    book: { dir: 'ltr' as const, rendition: { layout: 'pre-paginated' } },
    isOverflowX: () => panX !== null,
    isOverflowY: () => true,
    next: vi.fn(),
    prev: vi.fn(),
    pan: vi.fn(),
  };
  renderHook(() =>
    usePagination(
      BOOK_KEY,
      { current: view as unknown as FoliateView },
      { current: document.createElement('div') },
    ),
  );
  // A fast horizontal drag: `deltaX` < 0 drags the content left (toward the
  // page's right edge), > 0 drags it right.
  const swipe = (deltaX: number, withStart = true) => {
    const start = { screenX: 500, screenY: 400 };
    const end = { screenX: 500 + deltaX, screenY: 400 };
    const detail = (phase: TouchDetail['phase'], deltaT: number): TouchDetail => ({
      phase,
      touch: phase === 'start' ? start : end,
      touchStart: start,
      deltaX: phase === 'start' ? 0 : deltaX,
      deltaY: 0,
      deltaT,
    });
    if (withStart) dispatchTouchInterceptors(BOOK_KEY, detail('start', 0));
    return dispatchTouchInterceptors(BOOK_KEY, detail('end', 100));
  };
  return { view, swipe };
};

beforeEach(() => {
  h.setViewSettings.mockClear();
  h.viewSettings = { scrolled: false, zoomLevel: 200, zoomMode: 'fit-page' };
});

afterEach(() => {
  cleanup();
});

describe('swipe on a zoomed fixed-layout page', () => {
  test('dragging past the right edge turns to the next page', () => {
    const { view, swipe } = setup(1);
    expect(swipe(-200)).toBe(true);
    expect(view.next).toHaveBeenCalledTimes(1);
  });

  test('dragging past the left edge turns to the previous page', () => {
    const { view, swipe } = setup(0);
    expect(swipe(200)).toBe(true);
    expect(view.prev).toHaveBeenCalledTimes(1);
  });

  test('a page with no horizontal overflow turns either way', () => {
    const { view, swipe } = setup(null);
    swipe(-200);
    swipe(200);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(view.prev).toHaveBeenCalledTimes(1);
  });

  test('the page turned to opens at 100% zoom', () => {
    const { view, swipe } = setup(1);
    swipe(-200);
    expect(view.renderer.setAttribute).toHaveBeenCalledWith('scale-factor', 100);
    expect(h.setViewSettings).toHaveBeenCalledWith(
      BOOK_KEY,
      expect.objectContaining({ zoomLevel: 100 }),
    );
  });

  test('dragging away from the edge only pans', () => {
    const { view, swipe } = setup(1);
    expect(swipe(200)).toBe(false);
    expect(view.next).not.toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
  });

  test('a drag starting mid-page only pans, even toward an edge', () => {
    const { view, swipe } = setup(0.5);
    expect(swipe(-200)).toBe(false);
    expect(swipe(200)).toBe(false);
    expect(view.next).not.toHaveBeenCalled();
    expect(view.prev).not.toHaveBeenCalled();
  });

  test('a drag whose start was not seen only pans', () => {
    const { view, swipe } = setup(1);
    swipe(-200);
    h.viewSettings['zoomLevel'] = 200;
    expect(swipe(-200, false)).toBe(false);
    expect(view.next).toHaveBeenCalledTimes(1);
  });

  test('a right-to-left book turns forward past the left edge', () => {
    h.viewSettings = { ...h.viewSettings, rtl: true };
    const { view, swipe } = setup(0);
    swipe(200);
    expect(view.next).toHaveBeenCalledTimes(1);
  });
});
