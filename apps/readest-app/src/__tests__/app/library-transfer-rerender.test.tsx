import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTransferStore, type TransferItem } from '@/store/transferStore';

// Regression guard for issue #5047 ("Entire app freezes when uploading large
// files to Readest Cloud"). The library page reads a single boolean
// (`isTransferQueueOpen`) from the transfer store. During a bulk upload the
// store churns ~10 progress writes/sec per active transfer, so if the page
// subscribes to the WHOLE store (`const { isTransferQueueOpen } =
// useTransferStore()`) it re-renders the entire library tree on every tick and
// the app becomes unresponsive. A field selector must isolate the page from
// that churn: it may only re-render when `isTransferQueueOpen` itself flips.

const initialState = {
  transfers: {} as Record<string, TransferItem>,
  isQueuePaused: false,
  isTransferQueueOpen: false,
  maxConcurrent: 2,
  activeCount: 0,
};

beforeEach(() => {
  useTransferStore.setState(initialState);
});

afterEach(cleanup);

// Mirrors the page's subscription: a boolean field selector.
const renderCounter = { count: 0 };
function QueueOpenConsumer() {
  renderCounter.count += 1;
  const isTransferQueueOpen = useTransferStore((state) => state.isTransferQueueOpen);
  return <div data-testid='open'>{String(isTransferQueueOpen)}</div>;
}

describe('library transfer-store subscription (issue #5047)', () => {
  it('does not re-render on transfer progress churn', () => {
    renderCounter.count = 0;
    render(<QueueOpenConsumer />);
    expect(renderCounter.count).toBe(1);

    const id = useTransferStore.getState().addTransfer('hash1', 'Book One', 'upload');
    act(() => {
      useTransferStore.getState().setTransferStatus(id, 'in_progress');
    });

    // Simulate a burst of upload progress updates (the >10/sec churn that
    // would freeze the app if the page subscribed to the whole store).
    act(() => {
      for (let i = 1; i <= 50; i += 1) {
        useTransferStore.getState().updateTransferProgress(id, i * 2, i * 2, 100, 1000 + i);
      }
    });

    // The queue-open boolean never changed, so the consumer must not re-render.
    expect(renderCounter.count).toBe(1);
  });

  it('re-renders only when isTransferQueueOpen flips', () => {
    renderCounter.count = 0;
    render(<QueueOpenConsumer />);
    expect(renderCounter.count).toBe(1);

    act(() => {
      useTransferStore.getState().setIsTransferQueueOpen(true);
    });
    expect(renderCounter.count).toBe(2);

    // A no-op set to the same value must not re-render.
    act(() => {
      useTransferStore.getState().setIsTransferQueueOpen(true);
    });
    expect(renderCounter.count).toBe(2);
  });
});
