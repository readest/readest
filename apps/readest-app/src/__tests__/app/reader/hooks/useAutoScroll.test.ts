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
  return {
    useReaderStore: (selector?: (s: typeof state) => unknown) =>
      selector ? selector(state) : state,
  };
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
