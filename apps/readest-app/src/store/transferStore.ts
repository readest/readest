import { create } from 'zustand';
import type { BaseDir } from '@/types/system';

export type TransferType = 'upload' | 'download' | 'delete';
export type TransferStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type TransferKind = 'book' | 'replica';
/**
 * Why a transfer was cancelled. 'user' = an explicit cancel action;
 * 'policy' = the app cancelled it because Readest Cloud is not the
 * selected sync provider. Policy cancellations are not failures: they
 * are excluded from the failed bucket, Retry All, and per-item retry
 * (retrying would either no-op against the provider gate or loop
 * cancel-retry-cancel), and they are pruned on the next restore.
 */
export type TransferCancelReason = 'user' | 'policy';

export interface ReplicaTransferFile {
  logical: string;
  lfp: string;
  byteSize: number;
}

export interface TransferItem {
  id: string;
  kind: TransferKind;
  bookHash: string;
  bookTitle: string;
  replicaKind?: string;
  replicaId?: string;
  replicaReincarnation?: string;
  replicaFiles?: ReplicaTransferFile[];
  replicaBase?: BaseDir;
  type: TransferType;
  status: TransferStatus;
  progress: number; // 0-100 percentage
  totalBytes: number;
  transferredBytes: number;
  transferSpeed: number; // bytes per second
  error?: string;
  cancelReason?: TransferCancelReason;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  priority: number; // Lower = higher priority
  isBackground: boolean;
}

interface TransferState {
  transfers: Record<string, TransferItem>;
  isQueuePaused: boolean;
  isTransferQueueOpen: boolean;
  maxConcurrent: number;
  activeCount: number;

  // UI Actions
  setIsTransferQueueOpen: (isOpen: boolean) => void;

  // Actions
  addTransfer: (
    bookHash: string,
    bookTitle: string,
    type: TransferType,
    priority?: number,
    isBackground?: boolean,
  ) => string;
  addReplicaTransfer: (
    replicaKind: string,
    replicaId: string,
    displayTitle: string,
    type: TransferType,
    opts?: {
      priority?: number;
      isBackground?: boolean;
      files?: ReplicaTransferFile[];
      base?: BaseDir;
      reincarnation?: string;
    },
  ) => string;
  removeTransfer: (transferId: string) => void;
  updateTransferProgress: (
    transferId: string,
    progress: number,
    transferred: number,
    total: number,
    speed: number,
  ) => void;
  setTransferStatus: (
    transferId: string,
    status: TransferStatus,
    error?: string,
    cancelReason?: TransferCancelReason,
  ) => void;
  retryTransfer: (transferId: string) => void;
  incrementRetryCount: (transferId: string) => void;

  // Queue control
  pauseQueue: () => void;
  resumeQueue: () => void;
  clearCompleted: () => void;
  clearFailed: () => void;
  clearPending: () => void;
  clearAll: () => void;

  // Getters
  getPendingTransfers: () => TransferItem[];
  getActiveTransfers: () => TransferItem[];
  getFailedTransfers: () => TransferItem[];
  getCompletedTransfers: () => TransferItem[];
  getTransferByBookHash: (bookHash: string, type: TransferType) => TransferItem | undefined;
  getReplicaTransfer: (
    replicaKind: string,
    replicaId: string,
    type: TransferType,
  ) => TransferItem | undefined;
  getQueueStats: () => {
    pending: number;
    active: number;
    completed: number;
    failed: number;
    total: number;
  };

  // Internal
  setActiveCount: (count: number) => void;

  // Persistence
  restoreTransfers: (transfers: Record<string, TransferItem>, isQueuePaused: boolean) => void;
}

const generateTransferId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
};

/**
 * The single failed-bucket predicate. Every surface that shows, counts,
 * or retries "failed" transfers (store getters, useTransferQueue stats,
 * TransferQueuePanel filter/retry) must use this instead of matching
 * statuses inline, so policy cancellations stay out of the bucket
 * everywhere at once.
 */
export const isFailedLikeTransfer = (t: TransferItem): boolean =>
  t.status === 'failed' || (t.status === 'cancelled' && t.cancelReason !== 'policy');

export const useTransferStore = create<TransferState>((set, get) => ({
  transfers: {},
  isQueuePaused: false,
  isTransferQueueOpen: false,
  maxConcurrent: 2,
  activeCount: 0,

  setIsTransferQueueOpen: (isOpen) => set({ isTransferQueueOpen: isOpen }),

  addTransfer: (bookHash, bookTitle, type, priority = 10, isBackground = false) => {
    const id = generateTransferId();
    const transfer: TransferItem = {
      id,
      kind: 'book',
      bookHash,
      bookTitle,
      type,
      status: 'pending',
      progress: 0,
      totalBytes: 0,
      transferredBytes: 0,
      transferSpeed: 0,
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      priority,
      isBackground,
    };

    set((state) => ({
      transfers: { ...state.transfers, [id]: transfer },
    }));

    return id;
  },

  addReplicaTransfer: (replicaKind, replicaId, displayTitle, type, opts = {}) => {
    const id = generateTransferId();
    const transfer: TransferItem = {
      id,
      kind: 'replica',
      bookHash: '',
      bookTitle: displayTitle,
      replicaKind,
      replicaId,
      replicaReincarnation: opts.reincarnation,
      replicaFiles: opts.files,
      replicaBase: opts.base,
      type,
      status: 'pending',
      progress: 0,
      totalBytes: opts.files?.reduce((sum, f) => sum + f.byteSize, 0) ?? 0,
      transferredBytes: 0,
      transferSpeed: 0,
      retryCount: 0,
      maxRetries: 3,
      createdAt: Date.now(),
      priority: opts.priority ?? 10,
      isBackground: opts.isBackground ?? false,
    };

    set((state) => ({
      transfers: { ...state.transfers, [id]: transfer },
    }));

    return id;
  },

  removeTransfer: (transferId) => {
    set((state) => {
      const { [transferId]: _, ...remaining } = state.transfers;
      return { transfers: remaining };
    });
  },

  updateTransferProgress: (transferId, progress, transferred, total, speed) => {
    set((state) => {
      const transfer = state.transfers[transferId];
      if (!transfer) return state;

      // No-op when nothing meaningful changed: re-applying identical progress
      // would otherwise allocate a new state on every call and re-render every
      // subscriber, sustaining a render/update loop (Sentry READEST-2).
      // transferSpeed is deliberately excluded: it is recomputed from wall-clock
      // time on every emission (utils/transfer.ts), so it is almost always
      // different and would defeat the guard. A speed-only delta is not worth a
      // re-render. The primary defense against high-frequency churn is the
      // per-transfer coalescing in transferManager.
      if (
        transfer.progress === progress &&
        transfer.transferredBytes === transferred &&
        transfer.totalBytes === total
      ) {
        return state;
      }

      return {
        transfers: {
          ...state.transfers,
          [transferId]: {
            ...transfer,
            progress,
            transferredBytes: transferred,
            totalBytes: total,
            transferSpeed: speed,
          },
        },
      };
    });
  },

  setTransferStatus: (transferId, status, error, cancelReason) => {
    set((state) => {
      const transfer = state.transfers[transferId];
      if (!transfer) return state;

      const updates: Partial<TransferItem> = { status, error };
      if (status === 'cancelled') {
        updates.cancelReason = cancelReason ?? transfer.cancelReason ?? 'user';
      }

      if (status === 'in_progress' && !transfer.startedAt) {
        updates.startedAt = Date.now();
      }

      if (status === 'completed' || status === 'failed' || status === 'cancelled') {
        updates.completedAt = Date.now();
      }

      return {
        transfers: {
          ...state.transfers,
          [transferId]: { ...transfer, ...updates },
        },
      };
    });
  },

  retryTransfer: (transferId) => {
    set((state) => {
      const transfer = state.transfers[transferId];
      if (!transfer) return state;
      // Policy cancellations are not retryable: the provider gate would
      // re-cancel the row immediately (cancel-retry-cancel loop).
      if (transfer.status === 'cancelled' && transfer.cancelReason === 'policy') return state;

      return {
        transfers: {
          ...state.transfers,
          [transferId]: {
            ...transfer,
            status: 'pending',
            progress: 0,
            transferredBytes: 0,
            transferSpeed: 0,
            error: undefined,
            cancelReason: undefined,
            startedAt: undefined,
            completedAt: undefined,
          },
        },
      };
    });
  },

  incrementRetryCount: (transferId) => {
    set((state) => {
      const transfer = state.transfers[transferId];
      if (!transfer) return state;

      return {
        transfers: {
          ...state.transfers,
          [transferId]: {
            ...transfer,
            retryCount: transfer.retryCount + 1,
          },
        },
      };
    });
  },

  pauseQueue: () => set({ isQueuePaused: true }),
  resumeQueue: () => set({ isQueuePaused: false }),

  clearCompleted: () => {
    set((state) => {
      const remaining: Record<string, TransferItem> = {};
      Object.entries(state.transfers).forEach(([id, transfer]) => {
        if (transfer.status !== 'completed') {
          remaining[id] = transfer;
        }
      });
      return { transfers: remaining };
    });
  },

  clearFailed: () => {
    set((state) => {
      const remaining: Record<string, TransferItem> = {};
      Object.entries(state.transfers).forEach(([id, transfer]) => {
        if (transfer.status !== 'failed' && transfer.status !== 'cancelled') {
          remaining[id] = transfer;
        }
      });
      return { transfers: remaining };
    });
  },

  clearPending: () => {
    set((state) => {
      const remaining: Record<string, TransferItem> = {};
      Object.entries(state.transfers).forEach(([id, transfer]) => {
        if (transfer.status !== 'pending') {
          remaining[id] = transfer;
        }
      });
      return { transfers: remaining };
    });
  },

  clearAll: () => set({ transfers: {} }),

  getPendingTransfers: () => {
    return Object.values(get().transfers).filter((t) => t.status === 'pending');
  },

  getActiveTransfers: () => {
    return Object.values(get().transfers).filter((t) => t.status === 'in_progress');
  },

  getFailedTransfers: () => {
    return Object.values(get().transfers).filter(isFailedLikeTransfer);
  },

  getCompletedTransfers: () => {
    return Object.values(get().transfers).filter((t) => t.status === 'completed');
  },

  getTransferByBookHash: (bookHash, type) => {
    return Object.values(get().transfers).find(
      (t) =>
        t.kind === 'book' &&
        t.bookHash === bookHash &&
        t.type === type &&
        ['pending', 'in_progress'].includes(t.status),
    );
  },

  getReplicaTransfer: (replicaKind, replicaId, type) => {
    return Object.values(get().transfers).find(
      (t) =>
        t.kind === 'replica' &&
        t.replicaKind === replicaKind &&
        t.replicaId === replicaId &&
        t.type === type &&
        ['pending', 'in_progress'].includes(t.status),
    );
  },

  getQueueStats: () => {
    const transfers = Object.values(get().transfers);
    return {
      pending: transfers.filter((t) => t.status === 'pending').length,
      active: transfers.filter((t) => t.status === 'in_progress').length,
      completed: transfers.filter((t) => t.status === 'completed').length,
      failed: transfers.filter(isFailedLikeTransfer).length,
      total: transfers.length,
    };
  },

  setActiveCount: (count) => set({ activeCount: count }),

  restoreTransfers: (transfers, isQueuePaused) => {
    // Legacy rows persisted before the kind discriminator default to 'book'.
    const restoredTransfers: Record<string, TransferItem> = {};
    Object.entries(transfers).forEach(([id, transfer]) => {
      // Policy-cancelled rows are session-scoped history: a large
      // pre-switch queue must not leave hundreds of permanent
      // "Cancelled" rows in the panel and localStorage. Prune on
      // restore.
      if (transfer.status === 'cancelled' && transfer.cancelReason === 'policy') return;
      const withKind: TransferItem = { ...transfer, kind: transfer.kind ?? 'book' };
      if (withKind.status === 'in_progress') {
        restoredTransfers[id] = {
          ...withKind,
          status: 'pending',
          progress: 0,
          transferredBytes: 0,
          transferSpeed: 0,
        };
      } else {
        restoredTransfers[id] = withKind;
      }
    });
    set({ transfers: restoredTransfers, isQueuePaused });
  },
}));
