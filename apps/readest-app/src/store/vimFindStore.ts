import { create } from 'zustand';

// Vim-style find (#7281): `/` opens a command line at the bottom of the book,
// Enter searches and selects the match, and the search stays live, with `n`/`N`
// and the visual-mode motions, until Esc. One book has it at a time.
interface VimFindState {
  bookKey: string | null;
  typing: boolean;
  term: string;
  // Match CFIs in book order; `index` is the selected one, -1 before any.
  matches: string[];
  index: number;
  searching: boolean;
  error: string | null;
  openFind: (bookKey: string) => void;
  closeFind: () => void;
}

const initialState = {
  bookKey: null,
  typing: false,
  term: '',
  matches: [],
  index: -1,
  searching: false,
  error: null,
};

export const useVimFindStore = create<VimFindState>((set) => ({
  ...initialState,
  openFind: (bookKey) => set({ ...initialState, bookKey, typing: true }),
  closeFind: () => set(initialState),
}));

// The live search of `bookKey`: a term was searched and Esc hasn't ended it.
export const getLiveVimFind = (bookKey: string | null) => {
  const state = useVimFindStore.getState();
  return bookKey && state.bookKey === bookKey && !state.typing && state.term ? state : null;
};
