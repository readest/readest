import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { HardwarePageTurnerSettings } from '@/types/settings';
import type { FoliateView } from '@/types/view';

const hardwarePageTurner: HardwarePageTurnerSettings = {
  enabled: true,
  bindings: {
    pagePrev: null,
    pageNext: {
      source: 'dom',
      id: 'ArrowRight',
      label: 'Ctrl + Arrow Right',
      ctrlKey: true,
    },
    sectionPrev: null,
    sectionNext: null,
    refresh: null,
  },
};

const h = vi.hoisted(() => ({
  settingsState: { settings: { hardwarePageTurner: undefined as unknown } },
  setHoveredBookKey: vi.fn(),
}));

vi.mock('@/utils/bridge', () => ({
  interceptKeys: vi.fn(),
  getScreenBrightness: vi.fn(),
  setScreenBrightness: vi.fn(),
  refreshEinkScreen: vi.fn(),
}));

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({ appService: { isMobileApp: false, isAndroidApp: false } }),
}));

vi.mock('@/store/readerStore', () => ({
  useReaderStore: Object.assign(
    () => ({
      getViewSettings: () => ({ volumeKeysToFlip: false, readingRulerEnabled: false }),
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
    (selector?: (state: typeof h.settingsState) => unknown) =>
      selector ? selector(h.settingsState) : h.settingsState,
    { getState: () => h.settingsState },
  ),
}));

vi.mock('@/store/sidebarStore', () => ({
  useSidebarStore: Object.assign(() => ({}), { getState: () => ({ sideBarBookKey: 'book-1' }) }),
}));

import { usePagination } from '@/app/reader/hooks/usePagination';
import { handleKeydown } from '@/app/reader/utils/iframeEventHandlers';

const makeView = () => ({
  renderer: { scrolled: false },
  book: { dir: 'ltr' as const },
  next: vi.fn(),
  prev: vi.fn(),
});

const dispatchIframeKey = (
  modifiers: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> & {
    altGraphKey?: boolean;
    interactiveTarget?: boolean;
    repeat?: boolean;
  },
) => {
  act(() => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'iframe-keydown',
          bookKey: 'book-1',
          key: 'ArrowRight',
          code: 'ArrowRight',
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          metaKey: false,
          ...modifiers,
        },
      }),
    );
  });
};

beforeEach(() => {
  vi.clearAllMocks();
  h.settingsState = { settings: { hardwarePageTurner } };
});

afterEach(() => {
  cleanup();
});

describe('usePagination hardware DOM bindings', () => {
  test('matches iframe keys only when their modifiers match exactly', () => {
    const view = makeView();
    const viewRef = { current: view as unknown as FoliateView };
    const containerRef = { current: null };
    renderHook(() => usePagination('book-1', viewRef, containerRef));

    dispatchIframeKey({ ctrlKey: true });
    expect(view.next).toHaveBeenCalledTimes(1);

    dispatchIframeKey({});
    dispatchIframeKey({ ctrlKey: true, shiftKey: true });
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(view.prev).not.toHaveBeenCalled();
  });

  test('ignores forwarded iframe keys originating from editable controls', () => {
    const view = makeView();
    const viewRef = { current: view as unknown as FoliateView };
    const containerRef = { current: null };
    renderHook(() => usePagination('book-1', viewRef, containerRef));

    dispatchIframeKey({ ctrlKey: true, interactiveTarget: true });

    expect(view.next).not.toHaveBeenCalled();
  });

  test('ignores repeated iframe keydown messages', () => {
    const view = makeView();
    const viewRef = { current: view as unknown as FoliateView };
    const containerRef = { current: null };
    renderHook(() => usePagination('book-1', viewRef, containerRef));

    dispatchIframeKey({ ctrlKey: true, repeat: true });

    expect(view.next).not.toHaveBeenCalled();
  });

  test('preserves AltGraph as a distinct modifier in forwarded iframe keys', () => {
    h.settingsState = {
      settings: {
        hardwarePageTurner: {
          ...hardwarePageTurner,
          bindings: {
            ...hardwarePageTurner.bindings,
            pageNext: {
              source: 'dom',
              id: 'ArrowRight',
              label: 'Arrow Right',
              altGraphKey: true,
            },
          },
        },
      },
    };
    const view = makeView();
    const viewRef = { current: view as unknown as FoliateView };
    const containerRef = { current: null };
    renderHook(() => usePagination('book-1', viewRef, containerRef));

    dispatchIframeKey({ ctrlKey: true, altKey: true, altGraphKey: true });

    expect(view.next).toHaveBeenCalledTimes(1);
  });

  test('cancels the original iframe key event before its browser default runs', () => {
    const view = makeView();
    const viewRef = { current: view as unknown as FoliateView };
    const containerRef = { current: null };
    renderHook(() => usePagination('book-1', viewRef, containerRef));
    const postMessage = vi.spyOn(window, 'postMessage');
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      cancelable: true,
    });

    handleKeydown('book-1', event);

    expect(event.defaultPrevented).toBe(true);
    expect(view.next).toHaveBeenCalledTimes(1);
    expect(postMessage).not.toHaveBeenCalled();
    postMessage.mockRestore();
  });

  test('suppresses a repeated bound iframe chord without turning again', () => {
    const view = makeView();
    const viewRef = { current: view as unknown as FoliateView };
    const containerRef = { current: null };
    renderHook(() => usePagination('book-1', viewRef, containerRef));
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      repeat: true,
      cancelable: true,
    });

    handleKeydown('book-1', event);

    expect(event.defaultPrevented).toBe(true);
    expect(view.next).not.toHaveBeenCalled();
  });

  test('suppresses a repeated bound top-window chord without turning again', () => {
    const view = makeView();
    const viewRef = { current: view as unknown as FoliateView };
    const containerRef = { current: null };
    renderHook(() => usePagination('book-1', viewRef, containerRef));
    const event = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      code: 'ArrowRight',
      ctrlKey: true,
      repeat: true,
      cancelable: true,
    });

    act(() => window.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(view.next).not.toHaveBeenCalled();
  });
});
