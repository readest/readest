import { create } from 'zustand';
import { Book } from '@/types/book';
import { EnvConfigType } from '@/services/environment';

interface LibraryState {
  library: Book[]; // might contain deleted books
  checkOpenWithBooks: boolean;
  getVisibleLibrary: () => Book[];
  setCheckOpenWithBooks: (check: boolean) => void;
  setLibrary: (books: Book[]) => void;
  updateBook: (envConfig: EnvConfigType, book: Book) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: [],
  checkOpenWithBooks: true,
  getVisibleLibrary: () => get().library.filter((book) => !book.deletedAt),
  setCheckOpenWithBooks: (check) => set({ checkOpenWithBooks: check }),
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
