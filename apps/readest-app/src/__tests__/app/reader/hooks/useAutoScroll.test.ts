import { createElement, StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';

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
  applyPageTurnAttributes: vi.fn(),
  hoveredBookKey: null as string | null,
}));

vi.mock('@/store/readerStore', () => {
  const state = {
    get hoveredBookKey() {
      return h.hoveredBookKey;
    },
    get viewStates() {
      return { [BOOK_KEY]: { inited: h.inited, previewMode: h.previewMode } };
    },
    getViewSettings: () => h.viewSettings,
    getViewState: () => ({ inited: h.inited, previewMode: h.previewMode }),
    setAutoScrollEnabled: h.setAutoScrollEnabled,
  };
  const useReaderStore = (selector?: (s: typeof state) => unknown) =>
    selector ? selector(state) : state;
  useReaderStore.getState = () => ({ hoveredBookKey: h.hoveredBookKey });
  return { useReaderStore };
});
vi.mock('@/context/EnvContext', () => ({ useEnv: () => ({ envConfig: {} }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => (s: string) => s }));
vi.mock('@/helpers/settings', () => ({ saveViewSettings: h.saveViewSettings }));
vi.mock('@/app/reader/hooks/useCapturedTurn', () => ({
  applyPageTurnAttributes: h.applyPageTurnAttributes,
}));

import { useAutoScroll } from '@/app/reader/hooks/useAutoScroll';
import AutoScrollControl from '@/app/reader/components/AutoScrollControl';

const viewRef = {
  current: {
    next: vi.fn(),
    renderer: {
      scrolled: true,
      scrollProp: 'scrollTop',
      containerPosition: 0,
      atEnd: false,
      subpixelOffset: 0,
      toggleAttribute: vi.fn(),
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

  // #7575 review: switching to paginated mode applies its turn styles
  // before the scrolled session stops, while a session holds them off.
  test('applies the page turn styles once a session is over', async () => {
    const { result } = setup();
    await toggle();
    act(() => result.current.stop());

    expect(h.applyPageTurnAttributes).toHaveBeenCalledOnce();
    expect(h.setAutoScrollEnabled).toHaveBeenLastCalledWith(BOOK_KEY, false);
    expect(h.setAutoScrollEnabled.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      h.applyPageTurnAttributes.mock.invocationCallOrder[0]!,
    );
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
  // A paginator with one section loaded, filling a 600x800 page area.
  const section = document.createElement('iframe');
  const container = document.createElement('div');
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
    toggleAttribute: vi.fn(),
    shadowRoot: { getElementById: (id: string) => (id === 'container' ? container : null) },
    getContents: () => (section.contentDocument ? [{ doc: section.contentDocument }] : []),
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
  // The book's grid cell, and the layer over its viewer the copy of the page
  // being read goes in (FoliateViewer renders it during a wipe).
  let cell: HTMLDivElement;
  let host: HTMLDivElement;

  beforeEach(() => {
    h.viewSettings = {
      scrolled: false,
      vertical: false,
      autoScrollSpeed: 100,
      autoScrollRunning: false,
    };
    h.inited = true;
    h.hoveredBookKey = null;
    renderer.next.mockClear();
    renderer.prev.mockClear();
    viewNext.mockClear();
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'],
    });
    cell = document.createElement('div');
    cell.id = `gridcell-${BOOK_KEY}`;
    Object.defineProperties(cell, {
      clientWidth: { value: 600 },
      clientHeight: { value: 800 },
    });
    host = document.createElement('div');
    cell.append(host, section);
    document.body.append(cell);
    const doc = section.contentDocument!;
    doc.open();
    doc.write('<!DOCTYPE html><p>The page being read</p>');
    doc.close();
    // jsdom lays nothing out: the section fills the page area.
    const page = () => new DOMRect(0, 0, 600, 800);
    section.getBoundingClientRect = page;
    container.getBoundingClientRect = page;
  });

  afterEach(() => {
    cleanup();
    cell.remove();
    vi.useRealTimers();
  });

  const renderWipe = (commit?: React.RefObject<(() => void) | null>) => {
    const rendered = renderHook(() => useAutoScroll(BOOK_KEY, paginatedRef, commit));
    Object.assign(rendered.result.current.wipeCopyRef ?? {}, { current: host });
    return rendered;
  };

  // The copy of the page being read, while it is on screen.
  const copy = () =>
    host.querySelector<HTMLElement>('[data-page-wipe-copy]:not([style*="hidden"])');

  const reveal = async () => {
    await toggle();
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(renderer.next).toHaveBeenCalledOnce();
    expect(copy()).not.toBeNull();
  };

  // A touch on the page, which the copy of it takes while it is up.
  const press = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y });
    copy()!.dispatchEvent(event);
  };

  const click = () => copy()!.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  test('starts a session on a paginated horizontal book', async () => {
    const { result } = renderWipe();
    await toggle();

    expect(result.current.active).toBe(true);
    expect(result.current.wipe).toBe(true);
  });

  // The next page is wiped in under a copy of the page being read, which any
  // engine shows: iOS 18 WebKit has no layered View Transitions.
  test('wipes the next page in on an engine without View Transitions', async () => {
    expect('startViewTransition' in document).toBe(false);
    renderWipe();
    await reveal();
  });

  // #7575: a curl, flip or slide would play over the wipe.
  test('turns page animations off for the session and back on after it', async () => {
    h.viewSettings['animated'] = true;
    h.viewSettings['isEink'] = false;
    renderer.removeAttribute.mockClear();
    renderer.toggleAttribute.mockClear();
    const { result } = renderWipe();
    await toggle();
    expect(renderer.removeAttribute).toHaveBeenCalledWith('animated');
    expect(h.applyPageTurnAttributes).toHaveBeenCalledOnce();
    expect(h.setAutoScrollEnabled.mock.invocationCallOrder[0]!).toBeLessThan(
      h.applyPageTurnAttributes.mock.invocationCallOrder[0]!,
    );

    await act(async () => {
      result.current.stop();
    });
    expect(renderer.toggleAttribute).toHaveBeenLastCalledWith('animated', true);
    expect(h.applyPageTurnAttributes).toHaveBeenCalledTimes(2);
    // Applied once the session is over, so they turn the animations back on.
    expect(h.setAutoScrollEnabled).toHaveBeenLastCalledWith(BOOK_KEY, false);
    expect(h.setAutoScrollEnabled.mock.invocationCallOrder.at(-1)!).toBeLessThan(
      h.applyPageTurnAttributes.mock.invocationCallOrder[1]!,
    );
  });

  // Android: a tap on the controls' play button leaves them shown.
  test('keeps wiping the next page in while the controls are shown', async () => {
    const { container } = render(
      createElement(AutoScrollControl, {
        bookKey: BOOK_KEY,
        paused: false,
        speed: 100,
        onTogglePause: () => {},
        onAdjustSpeed: () => {},
        onStop: () => {},
        gridInsets: { top: 0, right: 0, bottom: 0, left: 0 },
      }),
      { container: cell.appendChild(document.createElement('div')) },
    );
    expect(container.firstElementChild!.className).toContain('opacity-100');
    renderWipe();
    await reveal();
  });

  test('keeps wiping the next page in while the toolbars are shown', async () => {
    h.hoveredBookKey = BOOK_KEY;
    renderWipe();
    await reveal();
  });

  test('starts a wipe on a paginated vertical book', async () => {
    h.viewSettings['vertical'] = true;
    const { result } = renderWipe();
    await reveal();
    expect(result.current.wipe).toBe(true);
  });

  // A book can switch writing axes between chapters.
  test('keeps wiping when the book turns to a vertical chapter', async () => {
    const { result, rerender } = renderWipe();
    await toggle();
    expect(result.current.active).toBe(true);

    h.viewSettings['vertical'] = true;
    rerender();
    expect(result.current.active).toBe(true);
  });

  // Xiaomi: a pause turned back and dropped the copy, so the page being read
  // showed above the line too, until the next tap brought the wipe back.
  test('a tap pauses and play resumes with the next page still above the line', async () => {
    const { result } = renderWipe();
    await reveal();

    await act(async () => {
      click();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.paused).toBe(true);
    expect(renderer.prev).not.toHaveBeenCalled();
    expect(copy()).not.toBeNull();

    await act(async () => {
      click();
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(result.current.paused).toBe(false);
    expect(renderer.prev).not.toHaveBeenCalled();
    expect(renderer.next).toHaveBeenCalledOnce();
    expect(copy()).not.toBeNull();
  });

  // Android: pausing at the press dropped the copy, and the tap's click then
  // landed on the book, whose single tap resumed.
  test('a tap pauses once', async () => {
    const { result } = renderWipe();
    await reveal();

    await act(async () => {
      press('pointerdown', 200, 300);
      press('pointerup', 200, 300);
      await vi.advanceTimersByTimeAsync(300);
    });
    // The click lands on whatever is on the page by then.
    await act(async () => {
      if (copy()) click();
      else eventDispatcher.dispatchSync('iframe-single-click');
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.paused).toBe(true);
  });

  // A swipe, such as the right-edge speed swipe, makes no click.
  test('a swipe does not pause', async () => {
    const { result } = renderWipe();
    await reveal();
    const x = window.innerWidth - 5;

    await act(async () => {
      press('pointerdown', x, 300);
      press('pointermove', x, 380);
      press('pointerup', x, 380);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.paused).toBe(false);
    expect(copy()).not.toBeNull();
  });

  // #7575 review: the live view is already on the next page under the copy,
  // so a key or button turn would otherwise skip that page.
  test('a page turn during a wipe moves one page from the page being read', async () => {
    renderWipe();
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
    renderWipe();
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

  // #7575 review: a stop's turn back put the page turn animation back once
  // it landed, also over a session started meanwhile.
  test('keeps page turns unanimated for a session started while a stop turns back', async () => {
    h.viewSettings['animated'] = true;
    h.viewSettings['isEink'] = false;
    const attributes = new Set<string>();
    const methods = Object.fromEntries(
      (['hasAttribute', 'setAttribute', 'removeAttribute', 'toggleAttribute'] as const).map(
        (name) => [name, renderer[name]],
      ),
    );
    Object.assign(renderer, {
      hasAttribute: (name: string) => attributes.has(name),
      setAttribute: (name: string) => void attributes.add(name),
      removeAttribute: (name: string) => void attributes.delete(name),
      toggleAttribute: (name: string, on: boolean) => {
        if (on) attributes.add(name);
        else attributes.delete(name);
        return on;
      },
    });
    try {
      const { result } = renderWipe();
      await reveal();
      let turnedBack = () => {};
      renderer.prev.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            turnedBack = resolve;
          }),
      );
      await act(async () => {
        result.current.stop();
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(renderer.prev).toHaveBeenCalledOnce();

      await toggle();
      await act(async () => {
        turnedBack();
        await vi.advanceTimersByTimeAsync(200);
      });
      expect(result.current.active).toBe(true);
      expect(attributes.has('animated')).toBe(false);
    } finally {
      Object.assign(renderer, methods);
    }
  });

  test('keeps the stopped wipe ahead of the reading position while a new one starts', async () => {
    const { result } = renderWipe();
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
    const { result } = renderWipe();
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
    const { result } = renderWipe();
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

  // Stopping turns back under the copy; until that lands, a page turn
  // or a new session would turn the same paginator.
  test('keeps page turns and a new session behind the turn back of a stop', async () => {
    const { result } = renderWipe();
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
      await act(async () => turnedBack());
    }
  });

  // The page turned to under the copy is committed as the reading
  // position only once it is wiped in.
  test('holds the page wiped in back from the reading position until it is wiped in', async () => {
    const commit = { current: vi.fn() };
    const { result } = renderWipe(commit);
    await reveal();
    expect(result.current.isWipeAhead()).toBe(true);
    expect(commit.current).not.toHaveBeenCalled();

    // 800px at 20px/s.
    await act(() => vi.advanceTimersByTimeAsync(41_000));
    expect(commit.current).toHaveBeenCalled();
  });
});
