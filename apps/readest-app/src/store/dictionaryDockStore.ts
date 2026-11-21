import { create } from 'zustand';
import type { UseDictionaryResultsArgs } from '@/app/reader/components/annotator/DictionaryResultsView';

interface DictionaryDockState {
  /**
   * The latest in-app lookup, shown in the Notebook's Dictionary tab (#7730).
   * `id` changes on every lookup so the tab starts each one fresh, as a popup does.
   */
  lookup: (UseDictionaryResultsArgs & { id: number }) | null;
  /** The Dictionary tab is on screen, so lookups show there instead of in a popup. */
  isDocked: boolean;
  setLookup: (lookup: UseDictionaryResultsArgs) => void;
  setDocked: (docked: boolean) => void;
}

export const useDictionaryDockStore = create<DictionaryDockState>((set) => ({
  lookup: null,
  isDocked: false,
  setLookup: (lookup) =>
    set((state) => ({ lookup: { ...lookup, id: (state.lookup?.id ?? 0) + 1 } })),
  setDocked: (isDocked) => set({ isDocked }),
}));
