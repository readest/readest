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

const BOOK_KEY = 'book-1';
const MEDIA = { elementType: 'image', src: 'blob:http://localhost/cover' };

// A tap on an image that fills the page arrives as a plain single click with the
// media attached (#6424): the tap zone decides between turning the page and
// opening the viewer.
const setup = (columnCount = 1, renderer: Record<string, unknown> = {}) => {
  const view = {
    renderer: {
      scrolled: false,
      columnCount,
      scrollHeight: 800,
      clientHeight: 800,
      getAttribute: () => null,
      ...renderer,
    },
    book: { dir: 'ltr' as const, rendition: {} },
    next: vi.fn(),
    prev: vi.fn(),
  };
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect;
  const { result } = renderHook(() =>
    usePagination(BOOK_KEY, { current: view as unknown as FoliateView }, { current: container }),
  );
  // The reader's iframe handlers post from the app window itself.
  const tap = async (screenX: number, source: MessageEventSource | null = window) => {
    await act(async () => {
      await result.current.handlePageFlip(
        new MessageEvent('message', {
          data: { bookKey: BOOK_KEY, type: 'iframe-single-click', screenX, media: MEDIA },
          source,
        }),
      );
    });
  };
  return { view, tap };
};

let postSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.viewSettings = { scrolled: false };
  h.bookData = {};
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

  test('media attached by a message from another window is not opened', async () => {
    const { tap } = setup();
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    await tap(500, frame.contentWindow);
    frame.remove();
    expect(postSpy).not.toHaveBeenCalled();
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

// In a two-page spread a page-filling image fills one column, so the tap zones
// are measured on that column; the spread's own center is the gutter (#6745).
describe('usePagination tap on a page-filling image in a two-column spread (#6745)', () => {
  test.each([250, 750])('a tap at the center of the column at %i opens the viewer', async (x) => {
    const { view, tap } = setup(2);
    await tap(x);
    expect(postSpy).toHaveBeenCalledWith(
      { type: 'iframe-open-media', bookKey: BOOK_KEY, ...MEDIA },
      '*',
    );
    expect(view.prev).not.toHaveBeenCalled();
    expect(view.next).not.toHaveBeenCalled();
  });

  test('a tap on the outer side of the left column turns back', async () => {
    const { view, tap } = setup(2);
    await tap(100);
    expect(view.prev).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('a tap on the inner side of the left column turns forward', async () => {
    const { view, tap } = setup(2);
    await tap(450);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('a fixed-layout spread keeps the zones of the whole view', async () => {
    h.bookData = { isFixedLayout: true };
    const { view, tap } = setup(2);
    await tap(250);
    expect(view.prev).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled();
  });
});

// A fixed-layout page that runs past the viewport hides the title, the other
// way to show the toolbar, so the center tap shows it there (#6866).
describe('usePagination center tap on an overflowing fixed-layout page (#6866)', () => {
  test('a scrolled comic page toggles the toolbar instead of opening the viewer', async () => {
    h.viewSettings = { scrolled: true };
    h.bookData = { isFixedLayout: true };
    const { tap } = setup(1, { scrolled: true, scrollHeight: 9000 });
    await tap(500);
    expect(h.setHoveredBookKey).toHaveBeenCalledWith(BOOK_KEY);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('a zoomed page that pans vertically toggles the toolbar', async () => {
    h.bookData = { isFixedLayout: true };
    const { tap } = setup(1, { scrollHeight: 1600 });
    await tap(500);
    expect(h.setHoveredBookKey).toHaveBeenCalledWith(BOOK_KEY);
    expect(postSpy).not.toHaveBeenCalled();
  });

  test('a fixed-layout page that fits still opens the viewer', async () => {
    h.bookData = { isFixedLayout: true };
    const { tap } = setup();
    await tap(500);
    expect(postSpy).toHaveBeenCalledWith(
      { type: 'iframe-open-media', bookKey: BOOK_KEY, ...MEDIA },
      '*',
    );
    expect(h.setHoveredBookKey).not.toHaveBeenCalled();
  });

  test('vertical writing keeps its title, so the center still opens the viewer', async () => {
    h.viewSettings = { scrolled: true, vertical: true };
    h.bookData = { isFixedLayout: true };
    const { tap } = setup(1, { scrolled: true, scrollHeight: 9000 });
    await tap(500);
    expect(postSpy).toHaveBeenCalledWith(
      { type: 'iframe-open-media', bookKey: BOOK_KEY, ...MEDIA },
      '*',
    );
  });
});
