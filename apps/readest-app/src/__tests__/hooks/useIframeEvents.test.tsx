import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';

vi.mock('@/store/readerStore', () => {
  return {
    useReaderStore: () => ({ hoveredBookKey: null }),
  };
});

vi.mock('@/store/bookDataStore', () => {
  return {
    useBookDataStore: () => ({ getBookData: () => null }),
  };
});

vi.mock('@/utils/event', () => ({
  eventDispatcher: { dispatch: vi.fn() },
}));

import { useMouseEvent } from '@/app/reader/hooks/useIframeEvents';

function dispatchWheelMessage(bookKey: string) {
  // useMouseEvent listens on `message`, not `window.postMessage` directly,
  // so we dispatch a MessageEvent manually for synchronous delivery.
  const event = new MessageEvent('message', {
    data: { bookKey, type: 'iframe-wheel', deltaY: 100, ctrlKey: false },
  });
  window.dispatchEvent(event);
}

describe('useMouseEvent debounce ref', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  test('debounced wheel handler dispatches to the latest handlePageFlip after re-render', () => {
    const fn1 = vi.fn();
    const fn2 = vi.fn();

    function Wrapper({ handler }: { handler: (msg: MessageEvent) => void }) {
      // useMouseEvent has the 2nd parameter typed as a union including
      // React.MouseEvent — we cast through unknown to satisfy the typecheck
      // for this focused unit test.
      useMouseEvent('book-1', handler as unknown as Parameters<typeof useMouseEvent>[1]);
      return null;
    }

    const { rerender } = render(<Wrapper handler={fn1} />);
    // Re-render with a new handler reference. The debounced wheel wrapper
    // should pick up the latest one rather than holding onto fn1 forever.
    rerender(<Wrapper handler={fn2} />);

    dispatchWheelMessage('book-1');
    act(() => {
      vi.advanceTimersByTime(150); // exceed the 100ms debounce
    });

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledTimes(1);
  });
});
