import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';

// A controllable stand-in for the global eventDispatcher: it tracks the
// `native-touch` listeners so a test can assert they never accumulate (the bug
// was that each section load added one and none were ever removed).
const nativeTouchListeners = new Set<(e: CustomEvent) => void>();
vi.mock('@/utils/event', () => ({
  eventDispatcher: {
    on: vi.fn((event: string, cb: (e: CustomEvent) => void) => {
      if (event === 'native-touch') nativeTouchListeners.add(cb);
    }),
    off: vi.fn((event: string, cb: (e: CustomEvent) => void) => {
      if (event === 'native-touch') nativeTouchListeners.delete(cb);
    }),
  },
}));

import { useRendererInputListeners } from '@/app/reader/hooks/useRendererInputListeners';
import type { FoliateView } from '@/types/view';

// Stand-in for the long-lived foliate paginator (an EventTarget). It records its
// `scroll` listeners so a test can prove they stay at exactly one per view.
class MockRenderer extends EventTarget {
  scrollListeners = new Set<EventListenerOrEventListenerObject>();
  override addEventListener(type: string, cb: EventListenerOrEventListenerObject, opts?: unknown) {
    if (type === 'scroll') this.scrollListeners.add(cb);
    super.addEventListener(type, cb, opts as AddEventListenerOptions);
  }
  override removeEventListener(
    type: string,
    cb: EventListenerOrEventListenerObject,
    opts?: unknown,
  ) {
    if (type === 'scroll') this.scrollListeners.delete(cb);
    super.removeEventListener(type, cb, opts as EventListenerOptions);
  }
}

const makeView = (renderer: MockRenderer) => ({ renderer }) as unknown as FoliateView;

const noopOpts = {
  onRendererScroll: () => {},
  enableNativeTouch: false,
  listenToNativeTouchEvents: () => {},
};

afterEach(() => {
  cleanup();
  nativeTouchListeners.clear();
  vi.clearAllMocks();
});

describe('useRendererInputListeners (paragraph-mode scroll/touch leak)', () => {
  it('registers exactly one renderer scroll listener and never accumulates across re-renders', () => {
    const renderer = new MockRenderer();
    const view = makeView(renderer);
    const { rerender } = renderHook(
      ({ s }) => useRendererInputListeners(view, { ...noopOpts, onRendererScroll: s }),
      { initialProps: { s: vi.fn() } },
    );

    expect(renderer.scrollListeners.size).toBe(1);

    // A long reading session re-renders the annotator many times (every section
    // load, progress update, popup toggle…). None of those may add a listener.
    for (let i = 0; i < 20; i++) rerender({ s: vi.fn() });
    expect(renderer.scrollListeners.size).toBe(1);
  });

  it('routes scroll events to the latest handler without re-subscribing', () => {
    const renderer = new MockRenderer();
    const view = makeView(renderer);
    const first = vi.fn();
    const { rerender } = renderHook(
      ({ s }) => useRendererInputListeners(view, { ...noopOpts, onRendererScroll: s }),
      { initialProps: { s: first } },
    );

    const second = vi.fn();
    rerender({ s: second });
    renderer.dispatchEvent(new Event('scroll'));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(renderer.scrollListeners.size).toBe(1);
  });

  it('removes the renderer scroll listener on unmount', () => {
    const renderer = new MockRenderer();
    const { unmount } = renderHook(() => useRendererInputListeners(makeView(renderer), noopOpts));

    expect(renderer.scrollListeners.size).toBe(1);
    unmount();
    expect(renderer.scrollListeners.size).toBe(0);
  });

  it('wires the Android native-touch bridge exactly once and tears it down on unmount', () => {
    const renderer = new MockRenderer();
    const view = makeView(renderer);
    const listenToNativeTouchEvents = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ t }) =>
        useRendererInputListeners(view, {
          onRendererScroll: () => {},
          onNativeTouch: t,
          enableNativeTouch: true,
          listenToNativeTouchEvents,
        }),
      { initialProps: { t: vi.fn() } },
    );

    expect(nativeTouchListeners.size).toBe(1);
    expect(listenToNativeTouchEvents).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 20; i++) rerender({ t: vi.fn() });
    expect(nativeTouchListeners.size).toBe(1);
    expect(listenToNativeTouchEvents).toHaveBeenCalledTimes(1);

    unmount();
    expect(nativeTouchListeners.size).toBe(0);
  });

  it('does not wire native-touch when not on Android', () => {
    const renderer = new MockRenderer();
    const listenToNativeTouchEvents = vi.fn();
    renderHook(() =>
      useRendererInputListeners(makeView(renderer), {
        onRendererScroll: () => {},
        onNativeTouch: vi.fn(),
        enableNativeTouch: false,
        listenToNativeTouchEvents,
      }),
    );

    expect(nativeTouchListeners.size).toBe(0);
    expect(listenToNativeTouchEvents).not.toHaveBeenCalled();
  });

  it('delivers native-touch events to the latest handler with the live event detail', () => {
    const renderer = new MockRenderer();
    const view = makeView(renderer);
    const first = vi.fn();
    const { rerender } = renderHook(
      ({ t }) =>
        useRendererInputListeners(view, {
          onRendererScroll: () => {},
          onNativeTouch: t,
          enableNativeTouch: true,
          listenToNativeTouchEvents: () => {},
        }),
      { initialProps: { t: first } },
    );

    const second = vi.fn();
    rerender({ t: second });
    const detail = { type: 'touchmove', x: 1, y: 2 };
    nativeTouchListeners.forEach((cb) => cb(new CustomEvent('native-touch', { detail })));

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(detail);
  });

  it('does not register anything until a view exists', () => {
    const { rerender } = renderHook(({ v }) => useRendererInputListeners(v, noopOpts), {
      initialProps: { v: null as FoliateView | null },
    });
    // No view yet → no throw, nothing wired.
    const renderer = new MockRenderer();
    rerender({ v: makeView(renderer) });
    expect(renderer.scrollListeners.size).toBe(1);
  });
});
