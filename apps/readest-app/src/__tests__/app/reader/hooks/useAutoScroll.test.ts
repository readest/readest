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
  theme: { isIPhoneDuo: false, safeAreaInsets: null as { right: number } | null },
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
vi.mock('@/store/themeStore', () => ({ useThemeStore: { getState: () => h.theme } }));

import { useAutoScroll } from '@/app/reader/hooks/useAutoScroll';
import { revealPageWipe } from '@/app/reader/utils/pageWipe';

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
  // Manual page turns (keys, buttons) go through the view, not the renderer.
  const viewNext = vi.fn(async () => {});
  const paginatedRef = {
    current: {
      isFixedLayout: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      next: viewNext,
      prev: vi.fn(async () => {}),
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

  // A book can switch writing axes between chapters.
  test('stops when the book turns to a vertical chapter', async () => {
    const { result, rerender } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
    await toggle();
    expect(result.current.active).toBe(true);

    h.viewSettings['vertical'] = true;
    rerender();
    expect(result.current.active).toBe(false);
  });

  describe('with View Transitions', () => {
    const skipTransition = vi.fn();
    let cell: HTMLDivElement;

    beforeEach(() => {
      renderer.next.mockClear();
      renderer.prev.mockClear();
      viewNext.mockClear();
      skipTransition.mockClear();
      vi.useFakeTimers({
        toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
      });
      vi.stubGlobal('CSS', { supports: () => true });
      Object.assign(document, {
        startViewTransition: (update: () => Promise<void>) => {
          const done = update();
          let finish = () => {};
          const finished = new Promise<void>((resolve) => {
            finish = resolve;
          });
          return {
            ready: done,
            updateCallbackDone: done,
            finished,
            skipTransition: () => {
              skipTransition();
              finish();
            },
          };
        },
      });
      document.documentElement.animate = vi.fn(
        () =>
          ({
            pause: vi.fn(),
            cancel: vi.fn(),
            effect: { setKeyframes: vi.fn() },
          }) as unknown as Animation,
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
      cleanup();
      cell.remove();
      vi.useRealTimers();
      vi.unstubAllGlobals();
      Reflect.deleteProperty(document, 'startViewTransition');
      Reflect.deleteProperty(document.documentElement, 'animate');
      h.theme = { isIPhoneDuo: false, safeAreaInsets: null };
    });

    const reveal = async () => {
      await toggle();
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(renderer.next).toHaveBeenCalledOnce();
    };

    // `screen` differs from the viewport point in a window away from the
    // screen origin.
    const press = (type: string, x: number, y: number, screen = { x, y }) =>
      act(() => {
        const event = new Event(type, { bubbles: true });
        Object.assign(event, {
          pointerType: 'touch',
          pointerId: 1,
          clientX: x,
          clientY: y,
          screenX: screen.x,
          screenY: screen.y,
        });
        document.documentElement.dispatchEvent(event);
      });

    // While the snapshot is up, the transition routes every press to <html>.
    test('a press pauses and turns back under the snapshot of the page being read', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();

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
      await reveal();

      const controls = document.createElement('div');
      controls.setAttribute('data-page-wipe-above', '');
      controls.setAttribute('data-visible', '');
      cell.append(controls);
      let turnedBack = () => {};
      renderer.prev.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            turnedBack = resolve;
          }),
      );
      await act(() => vi.advanceTimersByTimeAsync(100));
      expect(renderer.prev).toHaveBeenCalledOnce();

      act(() => {
        document.documentElement.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      });
      expect(result.current.paused).toBe(true);
      await act(async () => turnedBack());
    });

    // #7575 review: the live view is already on the next page under the
    // snapshot, so a key or button turn would otherwise skip that page.
    test('a page turn during a wipe moves one page from the page being read', async () => {
      renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();

      await act(async () => {
        await paginatedRef.current!.next();
      });

      expect(renderer.prev).toHaveBeenCalledOnce();
      expect(viewNext).toHaveBeenCalledOnce();
      expect(renderer.prev.mock.invocationCallOrder[0]!).toBeLessThan(
        viewNext.mock.invocationCallOrder[0]!,
      );
    });

    // The paginator ignores a turn until the last one settles, so a wipe
    // started meanwhile would think it turned when it did not.
    test('holds the wipe until a page turn of the reader lands', async () => {
      renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();
      let landed = () => {};
      viewNext.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            landed = resolve;
          }),
      );

      let turning: Promise<void> = Promise.resolve();
      await act(async () => {
        turning = paginatedRef.current!.next();
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(renderer.next).toHaveBeenCalledOnce();

      await act(async () => {
        landed();
        await turning;
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(renderer.next).toHaveBeenCalledTimes(2);
    });

    // The right-edge speed swipe starts on the book's iframe, which the
    // snapshot keeps from getting touches.
    test('a right-edge swipe does not pause, a right-edge tap does', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();
      const x = window.innerWidth - 5;

      press('pointerdown', x, 300);
      press('pointerup', x, 420);
      expect(result.current.paused).toBe(false);

      press('pointerdown', x, 300);
      press('pointerup', x, 302);
      expect(result.current.paused).toBe(true);
    });

    test('a right-edge swipe that comes back near its start does not pause', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();
      const x = window.innerWidth - 5;

      press('pointerdown', x, 300);
      press('pointermove', x, 340);
      press('pointerup', x, 302);
      expect(result.current.paused).toBe(false);
    });

    test('judges the right edge in the app viewport, not on the screen', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();

      // An interior touch in a window placed right of the screen origin.
      press('pointerdown', 500, 300, { x: window.innerWidth + 400, y: 300 });
      expect(result.current.paused).toBe(true);
    });

    // iPhone Duo's status strip is a right inset the swipe's zone ends before.
    test('a swipe in the right-edge zone before an iPhone Duo inset does not pause', async () => {
      h.theme = { isIPhoneDuo: true, safeAreaInsets: { right: 300 } };
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();

      press('pointerdown', 700, 300);
      expect(result.current.paused).toBe(false);
      press('pointerup', 700, 420);
      expect(result.current.paused).toBe(false);
    });

    test('keeps the stopped wipe ahead of the reading position while a new one starts', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();
      let turnedBack = () => {};
      renderer.prev.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            turnedBack = resolve;
          }),
      );
      try {
        act(() => result.current.stop());
        await act(() => vi.advanceTimersByTimeAsync(0));
        await toggle();
        expect(result.current.isWipeAhead()).toBe(true);

        await act(async () => {
          turnedBack();
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(result.current.isWipeAhead()).toBe(false);
      } finally {
        await act(async () => turnedBack());
      }
    });

    test('routes page turns through the stopped wipe until the last queued one lands', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();
      let turnedBack = () => {};
      renderer.prev.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            turnedBack = resolve;
          }),
      );
      let landed = () => {};
      viewNext.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            landed = resolve;
          }),
      );
      try {
        act(() => result.current.stop());
        await act(() => vi.advanceTimersByTimeAsync(0));
        let turning: Promise<void> = Promise.resolve();
        await act(async () => {
          turning = paginatedRef.current!.next();
          await vi.advanceTimersByTimeAsync(0);
        });
        await act(async () => {
          turnedBack();
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(viewNext).toHaveBeenCalledOnce();
        expect(paginatedRef.current!.next).not.toBe(viewNext);

        await act(async () => {
          landed();
          await turning;
          await vi.advanceTimersByTimeAsync(0);
        });
        expect(paginatedRef.current!.next).toBe(viewNext);
      } finally {
        await act(async () => {
          turnedBack();
          landed();
        });
      }
    });

    test('starts a new session only once a page turn queued behind a stop lands', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();
      let turnedBack = () => {};
      renderer.prev.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            turnedBack = resolve;
          }),
      );
      let landed = () => {};
      viewNext.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            landed = resolve;
          }),
      );
      try {
        act(() => result.current.stop());
        await act(() => vi.advanceTimersByTimeAsync(0));
        let turning: Promise<void> = Promise.resolve();
        await act(async () => {
          turning = paginatedRef.current!.next();
          await vi.advanceTimersByTimeAsync(0);
        });
        await act(async () => {
          turnedBack();
          await vi.advanceTimersByTimeAsync(0);
        });
        await toggle();
        await act(() => vi.advanceTimersByTimeAsync(200));
        expect(renderer.next).toHaveBeenCalledOnce();

        await act(async () => {
          landed();
          await turning;
          await vi.advanceTimersByTimeAsync(200);
        });
        expect(renderer.next).toHaveBeenCalledTimes(2);
      } finally {
        await act(async () => {
          turnedBack();
          landed();
        });
      }
    });

    // Stopping turns back under the snapshot; until that lands, a page turn
    // or a new session would turn the same paginator.
    test('keeps page turns and a new session behind the turn back of a stop', async () => {
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await reveal();
      let turnedBack = () => {};
      renderer.prev.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            turnedBack = resolve;
          }),
      );
      try {
        act(() => result.current.stop());
        await act(() => vi.advanceTimersByTimeAsync(0));
        expect(renderer.prev).toHaveBeenCalledOnce();

        let turning: Promise<void> = Promise.resolve();
        await act(async () => {
          turning = paginatedRef.current!.next();
          await vi.advanceTimersByTimeAsync(50);
        });
        expect(viewNext).not.toHaveBeenCalled();
        await toggle();
        await act(() => vi.advanceTimersByTimeAsync(200));
        expect(renderer.next).toHaveBeenCalledOnce();

        await act(async () => {
          turnedBack();
          await turning;
          await vi.advanceTimersByTimeAsync(200);
        });
        expect(viewNext).toHaveBeenCalledOnce();
        expect(renderer.next).toHaveBeenCalledTimes(2);
      } finally {
        // A failure above must not leave the snapshot holding the document.
        await act(async () => turnedBack());
      }
    });

    // The page turned to under the snapshot is committed as the reading
    // position only once it is wiped in.
    test('holds the page wiped in back from the reading position until it is wiped in', async () => {
      const commit = { current: vi.fn() };
      const { result } = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef, commit));
      await reveal();
      expect(result.current.isWipeAhead()).toBe(true);
      expect(commit.current).not.toHaveBeenCalled();

      // 800px at 20px/s.
      await act(() => vi.advanceTimersByTimeAsync(41_000));
      expect(commit.current).toHaveBeenCalled();
    });

    // Two books side by side: a second transition would end the first.
    test('leaves the snapshot to the book already showing one', async () => {
      const other = document.createElement('div');
      document.body.append(other);
      const otherReveal = await revealPageWipe(other, async () => {}, 'white');

      renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef));
      await toggle();
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(renderer.next).not.toHaveBeenCalled();

      await act(async () => otherReveal!.end());
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(renderer.next).toHaveBeenCalledOnce();
      other.remove();
    });
  });
});
