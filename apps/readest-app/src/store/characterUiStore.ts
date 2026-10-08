import { create } from 'zustand';

interface CharacterUiState {
  /** bookKey of the book whose character list should be shown, or null. */
  characterListBookKey: string | null;
  openCharacterList: (bookKey: string) => void;
  closeCharacterList: () => void;
}

export const useCharacterUiStore = create<CharacterUiState>((set) => ({
  characterListBookKey: null,
  openCharacterList: (bookKey) => set({ characterListBookKey: bookKey }),
  closeCharacterList: () => set({ characterListBookKey: null }),
}));
