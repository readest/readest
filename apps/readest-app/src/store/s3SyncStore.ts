import { create } from 'zustand';

interface S3SyncState {
  isSyncing: boolean;
  progressLabel: string | null;
  startedAt: number | null;

  beginSync: (initialLabel: string) => void;
  updateProgress: (label: string) => void;
  endSync: () => void;
}

export const useS3SyncStore = create<S3SyncState>((set) => ({
  isSyncing: false,
  progressLabel: null,
  startedAt: null,

  beginSync: (initialLabel) =>
    set({ isSyncing: true, progressLabel: initialLabel, startedAt: Date.now() }),
  updateProgress: (label) => set({ progressLabel: label }),
  endSync: () => set({ isSyncing: false, progressLabel: null, startedAt: null }),
}));
