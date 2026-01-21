import { create } from 'zustand';

export type TransferType = 'upload' | 'download' | 'delete';
export type TransferStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';

export interface TransferItem {
  id: string;
  bookHash: string;
  bookTitle: string;
  type: TransferType;
  status: TransferStatus;
  progress: number; // 0-100 percentage
  totalBytes: number;
  transferredBytes: number;
  transferSpeed: number; // bytes per second
  error?: string;
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
  removeTransfer: (transferId: string) => void;
  updateTransferProgress: (
    transferId: string,
    progress: number,
    transferred: number,
    total: number,
    speed: number,
  ) => void;
  setTransferStatus: (transferId: string, status: TransferStatus, error?: string) => void;
  retryTransfer: (transferId: string) => void;
  incrementRetryCount: (transferId: string) => void;

  // Queue control
  pauseQueue: () => void;
  resumeQueue: () => void;
  clearCompleted: () => void;
  clearFailed: () => void;
  clearAll: () => void;

  // Getters
  getPendingTransfers: () => TransferItem[];
  getActiveTransfers: () => TransferItem[];
  getFailedTransfers: () => TransferItem[];
  getCompletedTransfers: () => TransferItem[];
  getTransferByBookHash: (bookHash: string, type: TransferType) => TransferItem | undefined;
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

  setTransferStatus: (transferId, status, error) => {
    set((state) => {
      const transfer = state.transfers[transferId];
      if (!transfer) return state;

      const updates: Partial<TransferItem> = { status, error };

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

  clearAll: () => set({ transfers: {} }),

  getPendingTransfers: () => {
    return Object.values(get().transfers).filter((t) => t.status === 'pending');
  },

  getActiveTransfers: () => {
    return Object.values(get().transfers).filter((t) => t.status === 'in_progress');
  },

  getFailedTransfers: () => {
    return Object.values(get().transfers).filter(
      (t) => t.status === 'failed' || t.status === 'cancelled',
    );
  },

  getCompletedTransfers: () => {
    return Object.values(get().transfers).filter((t) => t.status === 'completed');
  },

  getTransferByBookHash: (bookHash, type) => {
    return Object.values(get().transfers).find(
      (t) =>
        t.bookHash === bookHash && t.type === type && ['pending', 'in_progress'].includes(t.status),
    );
  },

  getQueueStats: () => {
    const transfers = Object.values(get().transfers);
    return {
      pending: transfers.filter((t) => t.status === 'pending').length,
      active: transfers.filter((t) => t.status === 'in_progress').length,
      completed: transfers.filter((t) => t.status === 'completed').length,
      failed: transfers.filter((t) => t.status === 'failed' || t.status === 'cancelled').length,
      total: transfers.length,
    };
  },

  setActiveCount: (count) => set({ activeCount: count }),

  restoreTransfers: (transfers, isQueuePaused) => {
    // Reset in_progress transfers to pending when restoring
    const restoredTransfers: Record<string, TransferItem> = {};
    Object.entries(transfers).forEach(([id, transfer]) => {
      if (transfer.status === 'in_progress') {
        restoredTransfers[id] = {
          ...transfer,
          status: 'pending',
          progress: 0,
          transferredBytes: 0,
          transferSpeed: 0,
        };
      } else {
        restoredTransfers[id] = transfer;
      }
    });
    set({ transfers: restoredTransfers, isQueuePaused });
  },
}));
