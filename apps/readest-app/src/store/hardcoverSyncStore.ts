import { create } from 'zustand';

/** Process-local Hardcover push health, for the reader's sync row. */
interface HardcoverSyncState {
  /** In-flight pushes; several books can push at once. */
  pending: number;
  /** Error from the current or last batch of overlapping pushes; a new batch clears it. */
  lastError: string | null;
  begin: () => void;
  end: (error: string | null) => void;
}

export const useHardcoverSyncStore = create<HardcoverSyncState>((set) => ({
  pending: 0,
  lastError: null,
  begin: () =>
    set((s) => ({ pending: s.pending + 1, lastError: s.pending === 0 ? null : s.lastError })),
  end: (error) =>
    set((s) => ({ pending: Math.max(0, s.pending - 1), lastError: error ?? s.lastError })),
}));
