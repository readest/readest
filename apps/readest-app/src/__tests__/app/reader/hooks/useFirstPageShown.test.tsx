// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useReaderStore } from '@/store/readerStore';
import { useFirstPageShown } from '@/app/reader/hooks/useFirstPageShown';

/**
 * The reader's hidden toolbars build their buttons and panels once the book's first page is on
 * screen, not while it opens: on an e-ink reader running QuickJS (Readest Lite) building them took
 * a large share of the work between tapping a book and seeing its page.
 */

const setInited = (inited: boolean) =>
  act(() =>
    useReaderStore.setState({
      viewStates: {
        'book-1': { ...useReaderStore.getState().viewStates['book-1']!, inited },
      },
    }),
  );

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame'] });
  useReaderStore.setState({
    viewStates: {
      'book-1': { inited: false } as ReturnType<
        typeof useReaderStore.getState
      >['viewStates'][string],
    },
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useFirstPageShown', () => {
  it('turns true once the first page has been painted, not before', () => {
    const { result } = renderHook(() => useFirstPageShown('book-1'));
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);

    // The view went to the first page: it is painted with the next frame
    setInited(true);
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersToNextFrame());
    expect(result.current).toBe(false);
    // ...and the task that frame queued
    act(() => vi.runOnlyPendingTimers());
    expect(result.current).toBe(true);
  });

  it('is true at once for a book whose first page is already shown', () => {
    setInited(true);
    const { result } = renderHook(() => useFirstPageShown('book-1'));
    expect(result.current).toBe(true);
  });

  it('stays true when the view is recreated', () => {
    setInited(true);
    const { result } = renderHook(() => useFirstPageShown('book-1'));
    setInited(false);
    expect(result.current).toBe(true);
  });
});
