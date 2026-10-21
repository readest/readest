import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

const h = vi.hoisted(() => ({
  viewSettings: { scrolled: false } as Record<string, unknown>,
  bookData: {} as Record<string, unknown>,
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
  useBookDataStore: () => ({ getBookData: () => h.bookData }),
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
import { eventDispatcher } from '@/utils/event';

const BOOK_KEY = 'book-1';

// A click beside the page (a reflowable book's side margins, the space around a
// PDF page) lands on the reader's container, not in a page iframe. It must give
// the same single-click consumers the first chance a click on the page gets,
// so it dismisses the selection toolbar instead of turning the page under it
// (#6958).
const setup = () => {
  const view = {
    renderer: { scrolled: false, getAttribute: () => null },
    book: { dir: 'ltr' as const, rendition: {} },
    next: vi.fn(),
    prev: vi.fn(),
  };
  const { result } = renderHook(() =>
    usePagination(
      BOOK_KEY,
      { current: view as unknown as FoliateView },
      { current: document.createElement('div') },
    ),
  );
  const click = async (clientX: number) => {
    await act(async () => {
      await result.current.handlePageFlip({
        type: 'click',
        clientX,
        clientY: 400,
      } as React.MouseEvent<HTMLDivElement, MouseEvent>);
    });
  };
  return { view, click };
};

const consume = vi.fn(() => true);

beforeEach(() => {
  h.viewSettings = { scrolled: false };
  consume.mockClear();
});

afterEach(() => {
  cleanup();
  eventDispatcher.offSync('iframe-single-click', consume);
});

describe('usePagination click beside the page', () => {
  test('a consumed click does not turn the page', async () => {
    eventDispatcher.onSync('iframe-single-click', consume);
    const { view, click } = setup();
    await click(window.innerWidth - 10);
    expect(consume).toHaveBeenCalledOnce();
    expect(view.next).not.toHaveBeenCalled();
  });

  test('an unconsumed click still turns the page', async () => {
    const { view, click } = setup();
    await click(window.innerWidth - 10);
    expect(view.next).toHaveBeenCalledOnce();
  });
});
