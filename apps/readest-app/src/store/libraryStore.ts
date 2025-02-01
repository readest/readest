import { create } from 'zustand';
import { Book } from '@/types/book';
import { EnvConfigType } from '@/services/environment';

interface LibraryState {
  library: Book[];
  checkOpenWithBooks: boolean;
  clearOpenWithBooks: () => void;
  setLibrary: (books: Book[]) => void;
  updateBook: (envConfig: EnvConfigType, book: Book) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: [],
  checkOpenWithBooks: true,
  clearOpenWithBooks: () => set({ checkOpenWithBooks: false }),
  setLibrary: (books) => set({ library: books }),
  updateBook: async (envConfig: EnvConfigType, book: Book) => {
    const appService = await envConfig.getAppService();
    const { library } = get();
    const bookIndex = library.findIndex((b) => b.hash === book.hash);
    if (bookIndex !== -1) {
      library[bookIndex] = book;
    }
    set({ library });
    appService.saveLibraryBooks(library);
  },
}));
