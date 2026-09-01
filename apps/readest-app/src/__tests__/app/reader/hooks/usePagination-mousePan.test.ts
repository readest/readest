import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FoliateView } from '@/types/view';

const mocks = vi.hoisted(() => ({
  getBookData: vi.fn(),
  getViewSettings: vi.fn(),
  getViewState: vi.fn(),
  hoveredBookKey: null as string | null,
  setHoveredBookKey: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ appService: null }) }));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: mocks.getBookData }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: mocks.getViewSettings,
      getViewState: mocks.getViewState,
      hoveredBookKey: mocks.hoveredBookKey,
      setHoveredBookKey: mocks.setHoveredBookKey,
    }),
    { getState: () => ({ hoveredBookKey: mocks.hoveredBookKey }) },
  ),
}));
vi.mock('@/store/deviceStore', () => ({
  useDeviceControlStore: () => ({
    acquireVolumeKeyInterception: vi.fn(),
    releaseVolumeKeyInterception: vi.fn(),
    acquirePageTurnerKeyInterception: vi.fn(),
    releasePageTurnerKeyInterception: vi.fn(),
    ensureKeyForwarding: vi.fn(),
  }),
}));
vi.mock('@/store/settingsStore', () => ({
  useSettingsStore: Object.assign(() => undefined, { getState: () => ({ settings: {} }) }),
}));
vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(() => undefined, {
    getState: () => ({ sideBarBookKey: 'book-1' }),
  }),
}));
vi.mock('@/utils/bridge', () => ({ refreshEinkScreen: vi.fn() }));

import { usePagination } from '@/app/reader/hooks/usePagination';

const makeView = (x = true, y = true) => ({
  book: { rendition: { layout: 'pre-paginated' } },
  renderer: { scrolled: false },
  isOverflowX: () => x,
  isOverflowY: () => y,
  pan: vi.fn(),
  prev: vi.fn(),
  next: vi.fn(),
});

const point = (screenX: number, screenY: number, extra = {}) => ({
  type: 'iframe-mousedown' as const,
  bookKey: 'book-1',
  button: 0,
  screenX,
  screenY,
  hasTextSelection: false,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBookData.mockReturnValue({ isFixedLayout: true });
  mocks.getViewState.mockReturnValue({ inited: true });
  mocks.getViewSettings.mockReturnValue({ scrolled: false, zoomLevel: 150, zoomMode: 'fit-page' });
});
afterEach(() => cleanup());

describe('usePagination fixed-layout mouse pan', () => {
  test('claims after threshold and pans incrementally with opposite screen delta', () => {
    const view = makeView();
    const h = renderHook(() =>
      usePagination('book-1', { current: view as unknown as FoliateView }, { current: null }),
    );
    expect(h.result.current.handleMousePan(point(100, 100))).toBe(false);
    expect(
      h.result.current.handleMousePan({
        type: 'mousemove',
        bookKey: 'book-1',
        screenX: 103,
        screenY: 101,
      }),
    ).toBe(false);
    expect(
      h.result.current.handleMousePan({
        type: 'mousemove',
        bookKey: 'book-1',
        screenX: 120,
        screenY: 101,
      }),
    ).toBe(true);
    expect(view.pan).toHaveBeenCalledWith(-20, 0);
    expect(
      h.result.current.handleMousePan({
        type: 'mousemove',
        bookKey: 'book-1',
        screenX: 130,
        screenY: 101,
      }),
    ).toBe(true);
    expect(view.pan).toHaveBeenLastCalledWith(-10, 0);
    expect(
      h.result.current.handleMousePan({
        type: 'iframe-mouseup',
        bookKey: 'book-1',
        screenX: 130,
        screenY: 101,
      }),
    ).toBe(true);
  });

  test('ends a claimed drag when a move reports no buttons', () => {
    const view = makeView();
    const h = renderHook(() =>
      usePagination('book-1', { current: view as unknown as FoliateView }, { current: null }),
    );
    h.result.current.handleMousePan(point(100, 100));
    expect(
      h.result.current.handleMousePan({
        type: 'mousemove',
        bookKey: 'book-1',
        buttons: 1,
        screenX: 120,
        screenY: 100,
      }),
    ).toBe(true);

    expect(
      h.result.current.handleMousePan({
        type: 'mousemove',
        bookKey: 'book-1',
        buttons: 0,
        screenX: 140,
        screenY: 100,
      }),
    ).toBe(true);
    expect(
      h.result.current.handleMousePan({
        type: 'mousemove',
        bookKey: 'book-1',
        buttons: 1,
        screenX: 160,
        screenY: 100,
      }),
    ).toBe(false);
    expect(view.pan).toHaveBeenCalledOnce();
  });

  test('does not arm reflowable, scrolled, or non-overflowing views', () => {
    const view = makeView(false, false);
    const h = renderHook(() =>
      usePagination('book-1', { current: view as unknown as FoliateView }, { current: null }),
    );
    mocks.getBookData.mockReturnValue({ isFixedLayout: false });
    expect(h.result.current.handleMousePan(point(100, 100))).toBe(false);
    mocks.getBookData.mockReturnValue({ isFixedLayout: true });
    mocks.getViewSettings.mockReturnValue({ scrolled: true, zoomLevel: 150, zoomMode: 'fit-page' });
    expect(h.result.current.handleMousePan(point(100, 100))).toBe(false);
    expect(
      h.result.current.handleMousePan({
        type: 'mousemove',
        bookKey: 'book-1',
        screenX: 130,
        screenY: 100,
      }),
    ).toBe(false);
    expect(view.pan).not.toHaveBeenCalled();
  });

  test('selection and tap remain unclaimed', () => {
    const view = makeView();
    const h = renderHook(() =>
      usePagination('book-1', { current: view as unknown as FoliateView }, { current: null }),
    );
    expect(h.result.current.handleMousePan(point(100, 100, { hasTextSelection: true }))).toBe(
      false,
    );
    expect(h.result.current.handleMousePan(point(100, 100))).toBe(false);
    expect(
      h.result.current.handleMousePan({
        type: 'mouseup',
        bookKey: 'book-1',
        screenX: 100,
        screenY: 100,
      }),
    ).toBe(false);
    expect(view.pan).not.toHaveBeenCalled();
  });
});
