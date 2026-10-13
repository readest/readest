import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  viewSettings: { scrolled: false } as Record<string, unknown>,
  setHoveredBookKey: vi.fn(),
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
  useEnv: () => ({ appService: { isMobileApp: false } }),
}));
vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: () => h.viewSettings,
      getViewState: () => ({ inited: true }),
      hoveredBookKey: null,
      setHoveredBookKey: h.setHoveredBookKey,
    }),
    { getState: () => ({ hoveredBookKey: null }) },
  ),
}));
vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({ getBookData: () => ({}) }),
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
import type { FoliateView } from '@/types/view';

const BOOK_KEY = 'book-1';
const MEDIA = { elementType: 'image', src: 'blob:http://localhost/cover' };

// A tap on an image that fills the page arrives as a plain single click with the
// media attached (#6424): the tap zone decides between turning the page and
// opening the viewer.
const setup = () => {
  const view = {
    renderer: { scrolled: false },
    book: { dir: 'ltr' as const, rendition: {} },
    next: vi.fn(),
    prev: vi.fn(),
  };
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
  const { result } = renderHook(() =>
    usePagination(BOOK_KEY, { current: view as unknown as FoliateView }, { current: container }),
  );
  const tap = async (screenX: number) => {
    await act(async () => {
      await result.current.handlePageFlip(
        new MessageEvent('message', {
          data: { bookKey: BOOK_KEY, type: 'iframe-single-click', screenX, media: MEDIA },
        }),
      );
    });
  };
  return { view, tap };
};

let postSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.viewSettings = { scrolled: false };
  h.setHoveredBookKey.mockClear();
  postSpy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('usePagination tap on a page-filling image (#6424)', () => {
  test('a tap in the right page-turn zone turns the page', async () => {
    const { view, tap } = setup();
    await tap(900);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('a tap in the center zone opens the viewer instead of toggling the toolbar', async () => {
    const { view, tap } = setup();
    await tap(500);
    expect(postSpy).toHaveBeenCalledWith(
      { type: 'iframe-open-media', bookKey: BOOK_KEY, ...MEDIA },
      '*',
    );
    expect(h.setHoveredBookKey).not.toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });

  test('with tap-to-turn disabled, a tap anywhere opens the viewer', async () => {
    h.viewSettings = { scrolled: false, disableClick: true };
    const { view, tap } = setup();
    await tap(900);
    expect(postSpy).toHaveBeenCalledWith(
      { type: 'iframe-open-media', bookKey: BOOK_KEY, ...MEDIA },
      '*',
    );
    expect(view.next).not.toHaveBeenCalled();
  });
});
