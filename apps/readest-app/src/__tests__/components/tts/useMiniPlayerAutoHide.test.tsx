import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The hook reads only hoveredBookKey off the reader store; mock the store so
// the test can drive toolbar visibility without mounting the reader.
let hoveredBookKey: string | null = null;
vi.mock('@/store/readerStore', () => ({
  useReaderStore: () => ({ hoveredBookKey }),
}));

const { useMiniPlayerAutoHide } = await import('@/app/reader/components/tts/useMiniPlayerAutoHide');

const BOOK = 'book-1';

const setHovered = (key: string | null) => {
  hoveredBookKey = key;
};

describe('useMiniPlayerAutoHide', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setHovered(null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows the full player when the session starts, then hides it after 5s', () => {
    const { result } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', true));
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it('keeps the full player up for as long as the toolbar is shown', () => {
    setHovered(BOOK);
    const { result } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', true));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(true);
  });

  it('re-shows the full player when the toolbar comes back, and hides 5s after it clears', () => {
    const { result, rerender } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', true));

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);

    setHovered(BOOK);
    rerender();
    expect(result.current).toBe(true);

    setHovered('');
    rerender();
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });

  it('restarts the countdown when the toolbar reappears mid-countdown', () => {
    const { result, rerender } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', true));

    act(() => {
      vi.advanceTimersByTime(4000);
    });
    setHovered(BOOK);
    rerender();
    setHovered('');
    rerender();

    // The stale 1s remainder of the first countdown must not fire.
    act(() => {
      vi.advanceTimersByTime(4999);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe(false);
  });

  it('ignores another book taking the toolbar', () => {
    setHovered('book-2');
    const { result } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', true));

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });

  it('keeps the minimal player visible for the whole session', () => {
    const { result } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'minimal', true));

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current).toBe(true);
  });

  it('re-shows a hidden full player when the style switches to minimal', () => {
    let style: 'full' | 'minimal' = 'full';
    const { result, rerender } = renderHook(() => useMiniPlayerAutoHide(BOOK, style, true));

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);

    style = 'minimal';
    rerender();
    expect(result.current).toBe(true);
  });

  // The caller outlives every session, so the countdown has to be armed by the
  // card appearing, not by the hook mounting.
  it('does not burn the countdown before the card is on screen', () => {
    let mounted = false;
    const { result, rerender } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', mounted));

    // Book open, no session: an hour later the next session must still start
    // from a visible card, even with the toolbar down the whole time.
    act(() => {
      vi.advanceTimersByTime(3_600_000);
    });
    expect(result.current).toBe(true);

    mounted = true;
    rerender();
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);
  });

  it('hands back a visible card when the full player sheet closes', () => {
    let mounted = true;
    const { result, rerender } = renderHook(() => useMiniPlayerAutoHide(BOOK, 'full', mounted));

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(false);

    // Sheet opens over the card, then closes.
    mounted = false;
    rerender();
    mounted = true;
    rerender();
    expect(result.current).toBe(true);
  });
});
