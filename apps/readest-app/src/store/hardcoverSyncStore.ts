import { create } from 'zustand';

/** Process-local Hardcover push health, for the reader's sync row. */
interface HardcoverSyncState {
  /** In-flight pushes; several books can push at once. */
  pending: number;
  /** Last push error, cleared by the next success. */
  lastError: string | null;
  begin: () => void;
  end: (error: string | null) => void;
}

export const useHardcoverSyncStore = create<HardcoverSyncState>((set) => ({
  pending: 0,
  lastError: null,
  begin: () => set((s) => ({ pending: s.pending + 1 })),
  end: (error) => set((s) => ({ pending: Math.max(0, s.pending - 1), lastError: error })),
}));
