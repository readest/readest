import { describe, test, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

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

function dispatchWheelMessage(bookKey: string, deltaY = 100) {
  // useMouseEvent listens on `message`, not `window.postMessage` directly,
  // so we dispatch a MessageEvent manually for synchronous delivery.
  const event = new MessageEvent('message', {
    data: { bookKey, type: 'iframe-wheel', deltaY, deltaX: 0, deltaMode: 0, ctrlKey: false },
  });
  window.dispatchEvent(event);
}

describe('useMouseEvent wheel handling', () => {
  afterEach(() => {
    cleanup();
  });

  test('wheel flip dispatches to the latest handlePageFlip after re-render', () => {
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
    // Re-render with a new handler reference. The wheel flip path should
    // pick up the latest one rather than holding onto fn1 forever.
    rerender(<Wrapper handler={fn2} />);

    dispatchWheelMessage('book-1');

    expect(fn1).not.toHaveBeenCalled();
    expect(fn2).toHaveBeenCalledTimes(1);
  });

  test('a single deliberate wheel notch flips exactly one page', () => {
    const handler = vi.fn();

    function Wrapper() {
      useMouseEvent('book-1', handler as unknown as Parameters<typeof useMouseEvent>[1]);
      return null;
    }

    render(<Wrapper />);
    dispatchWheelMessage('book-1', 120);

    expect(handler).toHaveBeenCalledTimes(1);
  });

  test('tiny low-magnitude wheel events below the threshold do not flip', () => {
    const handler = vi.fn();

    function Wrapper() {
      useMouseEvent('book-1', handler as unknown as Parameters<typeof useMouseEvent>[1]);
      return null;
    }

    render(<Wrapper />);
    // A Magic Mouse light brush emits a flurry of tiny deltas; on their own
    // they must not turn a page.
    dispatchWheelMessage('book-1', 3);
    dispatchWheelMessage('book-1', 4);

    expect(handler).not.toHaveBeenCalled();
  });
});
