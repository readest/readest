import { create } from 'zustand';

interface HardcoverBookSync {
  /** In-flight pushes for this book. */
  pending: number;
  /** Error from the current or last batch of overlapping pushes; a new batch clears it. */
  lastError: string | null;
}

/** Process-local Hardcover push health per open book, for the reader's sync row. */
interface HardcoverSyncState {
  byBook: Record<string, HardcoverBookSync>;
  begin: (bookKey: string) => void;
  end: (bookKey: string, error: string | null) => void;
}

const IDLE: HardcoverBookSync = { pending: 0, lastError: null };

export const useHardcoverSyncStore = create<HardcoverSyncState>((set) => ({
  byBook: {},
  begin: (bookKey) =>
    set((s) => {
      const prev = s.byBook[bookKey] ?? IDLE;
      const next = { pending: prev.pending + 1, lastError: prev.pending ? prev.lastError : null };
      return { byBook: { ...s.byBook, [bookKey]: next } };
    }),
  end: (bookKey, error) =>
    set((s) => {
      const prev = s.byBook[bookKey] ?? IDLE;
      const next = { pending: Math.max(0, prev.pending - 1), lastError: error ?? prev.lastError };
      return { byBook: { ...s.byBook, [bookKey]: next } };
    }),
}));
