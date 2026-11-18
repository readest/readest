import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';

import { FoliateView } from '@/types/view';
import { eventDispatcher } from '@/utils/event';

const BOOK_KEY = 'book-1';

const h = vi.hoisted(() => ({
  viewSettings: { scrolled: true, autoScrollSpeed: 100, autoScrollRunning: false } as Record<
    string,
    unknown
  >,
  inited: false,
  previewMode: false,
  setAutoScrollEnabled: vi.fn(),
  saveViewSettings: vi.fn(),
}));

vi.mock('@/store/readerStore', () => {
  const state = {
    get viewStates() {
      return { [BOOK_KEY]: { inited: h.inited, previewMode: h.previewMode } };
    },
    getViewSettings: () => h.viewSettings,
    getViewState: () => ({ inited: h.inited, previewMode: h.previewMode }),
    setAutoScrollEnabled: h.setAutoScrollEnabled,
  };
  const useReaderStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useReaderStore.getState = () => ({ hoveredBookKey: null });
  return { useReaderStore };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: h.saveViewSettings }));

import { useAutoScroll } from '@/app/reader/hooks/useAutoScroll';

const viewRef = {
  current: {
    next: vi.fn(),
    renderer: {
      scrolled: true,
      scrollProp: 'scrollTop',
      containerPosition: 0,
      atEnd: false,
      subpixelOffset: 0,
    },
  },
} as unknown as React.RefObject<FoliateView | null>;

const setup = () => renderHook(() => useAutoScroll(BOOK_KEY, viewRef));

const toggle = async () => {
  await act(async () => {
    await eventDispatcher.dispatch('autoscroll-toggle', { bookKey: BOOK_KEY });
  });
};

const savedRunning = () =>
  h.saveViewSettings.mock.calls
    .filter((call) => call[2] === 'autoScrollRunning')
    .map((call) => call[3]);

beforeEach(() => {
  vi.clearAllMocks();
  h.viewSettings = { scrolled: true, autoScrollSpeed: 100, autoScrollRunning: false };
  h.inited = false;
  h.previewMode = false;
});

afterEach(() => {
  cleanup();
});

// Issue #5631: a session that was still running when the book was closed is
// resumed on reopen, so Auto Scroll readers don't re-toggle it every time.
describe('useAutoScroll session persistence', () => {
  test('records the running session so a reopen can resume it', async () => {
    h.inited = true;
    const { result } = setup();
    await toggle();

    expect(result.current.active).toBe(true);
    expect(savedRunning()).toEqual([true]);
  });

  test('clears the record when the session is explicitly stopped', async () => {
    h.inited = true;
    const { result } = setup();
    await toggle();
    h.saveViewSettings.mockClear();

    act(() => result.current.stop());

    expect(result.current.active).toBe(false);
    expect(savedRunning()).toEqual([false]);
  });

  // StrictMode mounts, tears down, and remounts every effect. The teardown
  // takes the same path closing the book does, so the "don't clear on close"
  // exemption must not survive into the remounted session.
  test('clears the record on an explicit stop after a StrictMode remount', async () => {
    h.inited = true;
    const { result } = renderHook(() => useAutoScroll(BOOK_KEY, viewRef), { wrapper: StrictMode });
    await toggle();
    h.saveViewSettings.mockClear();

    act(() => result.current.stop());

    expect(savedRunning()).toEqual([false]);
  });

  test('keeps the record when the book is closed mid-session', async () => {
    h.inited = true;
    const { unmount } = setup();
    await toggle();
    h.saveViewSettings.mockClear();

    unmount();

    expect(savedRunning()).toEqual([]);
  });

  test('resumes the session when a book with a recorded session is opened', () => {
    h.viewSettings['autoScrollRunning'] = true;
    h.inited = true;
    const { result } = setup();

    expect(result.current.active).toBe(true);
    expect(h.setAutoScrollEnabled).toHaveBeenCalledWith(BOOK_KEY, true);
  });

  test('does not resume before the view is inited', () => {
    h.viewSettings['autoScrollRunning'] = true;
    const { result } = setup();

    expect(result.current.active).toBe(false);
  });

  test('does not resume onto a deep-link landing the user has not confirmed', () => {
    h.viewSettings['autoScrollRunning'] = true;
    h.inited = true;
    h.previewMode = true;
    const { result } = setup();

    expect(result.current.active).toBe(false);
  });

  test('does not resume a book that was closed with no session running', () => {
    h.inited = true;
    const { result } = setup();

    expect(result.current.active).toBe(false);
  });
});

// #7575: in paginated mode the page stays still and a line wipes the next
// page in from the top, at the same speed the scrolled mode scrolls.
describe('useAutoScroll in paginated mode', () => {
  const renderer = {
    scrolled: false,
    isConnected: true,
    atEnd: false,
    columnCount: 1,
    next: vi.fn(async () => {}),
    prev: vi.fn(async () => {}),
    hasAttribute: () => false,
    setAttribute: vi.fn(),
    removeAttribute: vi.fn(),
    getContents: () => [],
  };
  const paginatedRef = {
    current: {
      isFixedLayout: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      renderer,
    },
  } as unknown as React.RefObject<FoliateView | null>;

  beforeEach(() => {
    h.viewSettings = {
      scrolled: false,
      vertical: false,
      autoScrollSpeed: 100,
      autoScrollRunning: false,
    };
    h.inited = true;
  });

  test('starts a session on a paginated horizontal book', async () => {
    const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
    await toggle();

    expect(result.current.active).toBe(true);
    expect(result.current.wipe).toBe(true);
  });

  test('does not start on a paginated vertical book', async () => {
    h.viewSettings['vertical'] = true;
    const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
    await toggle();

    expect(result.current.active).toBe(false);
  });

  describe('with View Transitions', () => {
    const skipTransition = vi.fn();
    let cell: HTMLDivElement;

    beforeEach(() => {
      renderer.next.mockClear();
      renderer.prev.mockClear();
      skipTransition.mockClear();
      vi.useFakeTimers({
        toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
      });
      vi.stubGlobal('CSS', { supports: () => true });
      Object.assign(document, {
        startViewTransition: (update: () => Promise<void>) => {
          const done = update();
          return {
            ready: done,
            updateCallbackDone: done,
            finished: new Promise(() => {}),
            skipTransition,
          };
        },
      });
      document.documentElement.animate = vi.fn(
        () => ({ pause: vi.fn(), effect: { setKeyframes: vi.fn() } }) as unknown as Animation,
      );
      cell = document.createElement('div');
      cell.id = `gridcell-${BOOK_KEY}`;
      Object.defineProperties(cell, {
        clientWidth: { value: 600 },
        clientHeight: { value: 800 },
      });
      document.body.append(cell);
    });

    afterEach(() => {
      cell.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      Reflect.deleteProperty(document, 'startViewTransition');
    });

    // While the snapshot is up, the transition routes every press to <html>.
    test('a press pauses and turns back under the snapshot of the page being read', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await toggle();
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(renderer.next).toHaveBeenCalledOnce();

      await act(async () => {
        document.documentElement.dispatchEvent(new Event('pointerdown', { bubbles: true }));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.paused).toBe(true);
      expect(renderer.prev).toHaveBeenCalledOnce();
      expect(skipTransition).toHaveBeenCalledOnce();
    });

    // On desktop the move before a click shows the controls, which starts
    // putting the snapshot away; the click lands while it is still up.
    test('a press pauses while the snapshot is being put away', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await toggle();
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(renderer.next).toHaveBeenCalledOnce();

      const controls = document.createElement('div');
      controls.setAttribute('data-page-wipe-above', '');
      controls.setAttribute('data-visible', '');
      cell.append(controls);
      renderer.prev.mockImplementationOnce(() => new Promise(() => {}));
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(renderer.prev).toHaveBeenCalledOnce();

      act(() => {
        document.documentElement.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(result.current.paused).toBe(true);
    });
  });
});
