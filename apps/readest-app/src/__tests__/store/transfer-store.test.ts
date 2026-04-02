import { describe, test, expect, beforeEach } from 'vitest';
import { useTransferStore, TransferItem, TransferStatus } from '@/store/transferStore';

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

describe('transferStore', () => {
  // ── addTransfer ──────────────────────────────────────────────────
  describe('addTransfer', () => {
    test('adds a transfer with correct defaults', () => {
      const id = useTransferStore.getState().addTransfer('hash1', 'Book One', 'upload');
      const transfer = useTransferStore.getState().transfers[id];
      expect(transfer).toBeDefined();
      expect(transfer!.bookHash).toBe('hash1');
      expect(transfer!.bookTitle).toBe('Book One');
      expect(transfer!.type).toBe('upload');
      expect(transfer!.status).toBe('pending');
      expect(transfer!.progress).toBe(0);
      expect(transfer!.retryCount).toBe(0);
      expect(transfer!.maxRetries).toBe(3);
      expect(transfer!.priority).toBe(10);
      expect(transfer!.isBackground).toBe(false);
    });

    test('accepts custom priority and isBackground', () => {
      const id = useTransferStore.getState().addTransfer('hash2', 'Book Two', 'download', 1, true);
      const transfer = useTransferStore.getState().transfers[id]!;
      expect(transfer.priority).toBe(1);
      expect(transfer.isBackground).toBe(true);
    });

    test('returns a unique id', () => {
      const id1 = useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      const id2 = useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      expect(id1).not.toBe(id2);
    });
  });

  // ── removeTransfer ───────────────────────────────────────────────
  describe('removeTransfer', () => {
    test('removes an existing transfer', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      expect(useTransferStore.getState().transfers[id]).toBeDefined();
      useTransferStore.getState().removeTransfer(id);
      expect(useTransferStore.getState().transfers[id]).toBeUndefined();
    });

    test('does not throw when removing a non-existent transfer', () => {
      expect(() => useTransferStore.getState().removeTransfer('nonexistent')).not.toThrow();
    });
  });

  // ── updateTransferProgress ───────────────────────────────────────
  describe('updateTransferProgress', () => {
    test('updates progress, transferred bytes, total bytes, and speed', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      useTransferStore.getState().updateTransferProgress(id, 50, 500, 1000, 100);
      const t = useTransferStore.getState().transfers[id]!;
      expect(t.progress).toBe(50);
      expect(t.transferredBytes).toBe(500);
      expect(t.totalBytes).toBe(1000);
      expect(t.transferSpeed).toBe(100);
    });

    test('is a no-op for a non-existent transfer', () => {
      const before = { ...useTransferStore.getState().transfers };
      useTransferStore.getState().updateTransferProgress('nope', 10, 10, 100, 5);
      expect(useTransferStore.getState().transfers).toEqual(before);
    });
  });

  // ── setTransferStatus ────────────────────────────────────────────
  describe('setTransferStatus', () => {
    test('sets status to in_progress and records startedAt', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      useTransferStore.getState().setTransferStatus(id, 'in_progress');
      const t = useTransferStore.getState().transfers[id]!;
      expect(t.status).toBe('in_progress');
      expect(t.startedAt).toBeDefined();
      expect(t.completedAt).toBeUndefined();
    });

    test('does not overwrite startedAt if already set', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      useTransferStore.getState().setTransferStatus(id, 'in_progress');
      const startedAt = useTransferStore.getState().transfers[id]!.startedAt;
      useTransferStore.getState().setTransferStatus(id, 'in_progress');
      expect(useTransferStore.getState().transfers[id]!.startedAt).toBe(startedAt);
    });

    test('sets completedAt for completed status', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      useTransferStore.getState().setTransferStatus(id, 'completed');
      const t = useTransferStore.getState().transfers[id]!;
      expect(t.status).toBe('completed');
      expect(t.completedAt).toBeDefined();
    });

    test('sets completedAt for failed status and records error', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      useTransferStore.getState().setTransferStatus(id, 'failed', 'Network error');
      const t = useTransferStore.getState().transfers[id]!;
      expect(t.status).toBe('failed');
      expect(t.error).toBe('Network error');
      expect(t.completedAt).toBeDefined();
    });

    test('sets completedAt for cancelled status', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      useTransferStore.getState().setTransferStatus(id, 'cancelled');
      const t = useTransferStore.getState().transfers[id]!;
      expect(t.status).toBe('cancelled');
      expect(t.completedAt).toBeDefined();
    });

    test('is a no-op for a non-existent transfer', () => {
      const before = { ...useTransferStore.getState().transfers };
      useTransferStore.getState().setTransferStatus('nope', 'completed');
      expect(useTransferStore.getState().transfers).toEqual(before);
    });
  });

  // ── retryTransfer ────────────────────────────────────────────────
  describe('retryTransfer', () => {
    test('resets a failed transfer to pending', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      useTransferStore.getState().setTransferStatus(id, 'in_progress');
      useTransferStore.getState().updateTransferProgress(id, 50, 500, 1000, 100);
      useTransferStore.getState().setTransferStatus(id, 'failed', 'timeout');

      useTransferStore.getState().retryTransfer(id);
      const t = useTransferStore.getState().transfers[id]!;
      expect(t.status).toBe('pending');
      expect(t.progress).toBe(0);
      expect(t.transferredBytes).toBe(0);
      expect(t.transferSpeed).toBe(0);
      expect(t.error).toBeUndefined();
      expect(t.startedAt).toBeUndefined();
      expect(t.completedAt).toBeUndefined();
    });

    test('is a no-op for a non-existent transfer', () => {
      const before = { ...useTransferStore.getState().transfers };
      useTransferStore.getState().retryTransfer('nope');
      expect(useTransferStore.getState().transfers).toEqual(before);
    });
  });

  // ── incrementRetryCount ──────────────────────────────────────────
  describe('incrementRetryCount', () => {
    test('increments retry count by 1', () => {
      const id = useTransferStore.getState().addTransfer('h', 'B', 'upload');
      expect(useTransferStore.getState().transfers[id]!.retryCount).toBe(0);
      useTransferStore.getState().incrementRetryCount(id);
      expect(useTransferStore.getState().transfers[id]!.retryCount).toBe(1);
      useTransferStore.getState().incrementRetryCount(id);
      expect(useTransferStore.getState().transfers[id]!.retryCount).toBe(2);
    });

    test('is a no-op for a non-existent transfer', () => {
      const before = { ...useTransferStore.getState().transfers };
      useTransferStore.getState().incrementRetryCount('nope');
      expect(useTransferStore.getState().transfers).toEqual(before);
    });
  });

  // ── pauseQueue / resumeQueue ─────────────────────────────────────
  describe('pauseQueue / resumeQueue', () => {
    test('pauseQueue sets isQueuePaused to true', () => {
      useTransferStore.getState().pauseQueue();
      expect(useTransferStore.getState().isQueuePaused).toBe(true);
    });

    test('resumeQueue sets isQueuePaused to false', () => {
      useTransferStore.getState().pauseQueue();
      useTransferStore.getState().resumeQueue();
      expect(useTransferStore.getState().isQueuePaused).toBe(false);
    });
  });

  // ── clearCompleted ───────────────────────────────────────────────
  describe('clearCompleted', () => {
    test('removes only completed transfers', () => {
      const id1 = useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      const id2 = useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      const id3 = useTransferStore.getState().addTransfer('h3', 'B3', 'upload');
      useTransferStore.getState().setTransferStatus(id1, 'completed');
      useTransferStore.getState().setTransferStatus(id2, 'failed', 'err');
      // id3 remains pending

      useTransferStore.getState().clearCompleted();
      const transfers = useTransferStore.getState().transfers;
      expect(transfers[id1]).toBeUndefined();
      expect(transfers[id2]).toBeDefined();
      expect(transfers[id3]).toBeDefined();
    });
  });

  // ── clearFailed ──────────────────────────────────────────────────
  describe('clearFailed', () => {
    test('removes failed and cancelled transfers', () => {
      const id1 = useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      const id2 = useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      const id3 = useTransferStore.getState().addTransfer('h3', 'B3', 'upload');
      const id4 = useTransferStore.getState().addTransfer('h4', 'B4', 'delete');
      useTransferStore.getState().setTransferStatus(id1, 'failed', 'err');
      useTransferStore.getState().setTransferStatus(id2, 'cancelled');
      useTransferStore.getState().setTransferStatus(id3, 'completed');
      // id4 remains pending

      useTransferStore.getState().clearFailed();
      const transfers = useTransferStore.getState().transfers;
      expect(transfers[id1]).toBeUndefined();
      expect(transfers[id2]).toBeUndefined();
      expect(transfers[id3]).toBeDefined();
      expect(transfers[id4]).toBeDefined();
    });
  });

  // ── clearAll ─────────────────────────────────────────────────────
  describe('clearAll', () => {
    test('removes all transfers', () => {
      useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      useTransferStore.getState().clearAll();
      expect(Object.keys(useTransferStore.getState().transfers)).toHaveLength(0);
    });
  });

  // ── getter helpers ───────────────────────────────────────────────
  describe('getPendingTransfers', () => {
    test('returns only pending transfers', () => {
      const id1 = useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      useTransferStore.getState().setTransferStatus(id1, 'in_progress');
      const pending = useTransferStore.getState().getPendingTransfers();
      expect(pending).toHaveLength(1);
      expect(pending[0]!.status).toBe('pending');
    });
  });

  describe('getActiveTransfers', () => {
    test('returns only in_progress transfers', () => {
      const id1 = useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      useTransferStore.getState().setTransferStatus(id1, 'in_progress');
      const active = useTransferStore.getState().getActiveTransfers();
      expect(active).toHaveLength(1);
      expect(active[0]!.status).toBe('in_progress');
    });
  });

  describe('getFailedTransfers', () => {
    test('returns failed and cancelled transfers', () => {
      const id1 = useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      const id2 = useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      useTransferStore.getState().addTransfer('h3', 'B3', 'upload');
      useTransferStore.getState().setTransferStatus(id1, 'failed', 'err');
      useTransferStore.getState().setTransferStatus(id2, 'cancelled');
      const failed = useTransferStore.getState().getFailedTransfers();
      expect(failed).toHaveLength(2);
      const statuses = failed.map((f) => f.status);
      expect(statuses).toContain('failed');
      expect(statuses).toContain('cancelled');
    });
  });

  describe('getCompletedTransfers', () => {
    test('returns only completed transfers', () => {
      const id1 = useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      useTransferStore.getState().setTransferStatus(id1, 'completed');
      const completed = useTransferStore.getState().getCompletedTransfers();
      expect(completed).toHaveLength(1);
      expect(completed[0]!.status).toBe('completed');
    });
  });

  describe('getTransferByBookHash', () => {
    test('finds pending transfer by bookHash and type', () => {
      useTransferStore.getState().addTransfer('hash1', 'B1', 'upload');
      const match = useTransferStore.getState().getTransferByBookHash('hash1', 'upload');
      expect(match).toBeDefined();
      expect(match!.bookHash).toBe('hash1');
    });

    test('finds in_progress transfer by bookHash and type', () => {
      const id = useTransferStore.getState().addTransfer('hash1', 'B1', 'download');
      useTransferStore.getState().setTransferStatus(id, 'in_progress');
      const match = useTransferStore.getState().getTransferByBookHash('hash1', 'download');
      expect(match).toBeDefined();
      expect(match!.status).toBe('in_progress');
    });

    test('returns undefined for completed transfer', () => {
      const id = useTransferStore.getState().addTransfer('hash1', 'B1', 'upload');
      useTransferStore.getState().setTransferStatus(id, 'completed');
      const match = useTransferStore.getState().getTransferByBookHash('hash1', 'upload');
      expect(match).toBeUndefined();
    });

    test('returns undefined when type does not match', () => {
      useTransferStore.getState().addTransfer('hash1', 'B1', 'upload');
      const match = useTransferStore.getState().getTransferByBookHash('hash1', 'download');
      expect(match).toBeUndefined();
    });
  });

  describe('getQueueStats', () => {
    test('returns correct counts for all statuses', () => {
      const id1 = useTransferStore.getState().addTransfer('h1', 'B1', 'upload');
      const id2 = useTransferStore.getState().addTransfer('h2', 'B2', 'download');
      const id3 = useTransferStore.getState().addTransfer('h3', 'B3', 'upload');
      const id4 = useTransferStore.getState().addTransfer('h4', 'B4', 'delete');
      useTransferStore.getState().addTransfer('h5', 'B5', 'upload'); // pending

      useTransferStore.getState().setTransferStatus(id1, 'in_progress');
      useTransferStore.getState().setTransferStatus(id2, 'completed');
      useTransferStore.getState().setTransferStatus(id3, 'failed', 'err');
      useTransferStore.getState().setTransferStatus(id4, 'cancelled');

      const stats = useTransferStore.getState().getQueueStats();
      expect(stats.pending).toBe(1);
      expect(stats.active).toBe(1);
      expect(stats.completed).toBe(1);
      expect(stats.failed).toBe(2); // failed + cancelled
      expect(stats.total).toBe(5);
    });

    test('returns all zeros for empty queue', () => {
      const stats = useTransferStore.getState().getQueueStats();
      expect(stats).toEqual({ pending: 0, active: 0, completed: 0, failed: 0, total: 0 });
    });
  });

  // ── restoreTransfers ─────────────────────────────────────────────
  describe('restoreTransfers', () => {
    test('restores transfers and resets in_progress to pending', () => {
      const now = Date.now();
      const transfers: Record<string, TransferItem> = {
        t1: {
          id: 't1',
          bookHash: 'h1',
          bookTitle: 'B1',
          type: 'upload',
          status: 'in_progress' as TransferStatus,
          progress: 50,
          totalBytes: 1000,
          transferredBytes: 500,
          transferSpeed: 100,
          retryCount: 0,
          maxRetries: 3,
          createdAt: now,
          startedAt: now,
          priority: 10,
          isBackground: false,
        },
        t2: {
          id: 't2',
          bookHash: 'h2',
          bookTitle: 'B2',
          type: 'download',
          status: 'completed' as TransferStatus,
          progress: 100,
          totalBytes: 2000,
          transferredBytes: 2000,
          transferSpeed: 0,
          retryCount: 0,
          maxRetries: 3,
          createdAt: now,
          completedAt: now,
          priority: 10,
          isBackground: false,
        },
      };

      useTransferStore.getState().restoreTransfers(transfers, true);
      const state = useTransferStore.getState();

      // in_progress transfer should be reset to pending
      const t1 = state.transfers['t1']!;
      expect(t1.status).toBe('pending');
      expect(t1.progress).toBe(0);
      expect(t1.transferredBytes).toBe(0);
      expect(t1.transferSpeed).toBe(0);

      // completed transfer should be unchanged
      const t2 = state.transfers['t2']!;
      expect(t2.status).toBe('completed');
      expect(t2.progress).toBe(100);

      // isQueuePaused should be restored
      expect(state.isQueuePaused).toBe(true);
    });

    test('restores with isQueuePaused false', () => {
      useTransferStore.getState().restoreTransfers({}, false);
      expect(useTransferStore.getState().isQueuePaused).toBe(false);
    });
  });

  // ── setIsTransferQueueOpen ───────────────────────────────────────
  describe('setIsTransferQueueOpen', () => {
    test('sets isTransferQueueOpen to true', () => {
      useTransferStore.getState().setIsTransferQueueOpen(true);
      expect(useTransferStore.getState().isTransferQueueOpen).toBe(true);
    });

    test('sets isTransferQueueOpen to false', () => {
      useTransferStore.getState().setIsTransferQueueOpen(true);
      useTransferStore.getState().setIsTransferQueueOpen(false);
      expect(useTransferStore.getState().isTransferQueueOpen).toBe(false);
    });
  });

  // ── setActiveCount ───────────────────────────────────────────────
  describe('setActiveCount', () => {
    test('sets activeCount', () => {
      useTransferStore.getState().setActiveCount(5);
      expect(useTransferStore.getState().activeCount).toBe(5);
    });
  });
});
