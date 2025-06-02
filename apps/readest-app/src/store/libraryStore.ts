import { create } from 'zustand';
import { Book, BooksGroup } from '@/types/book';
import { EnvConfigType, isTauriAppPlatform } from '@/services/environment';

interface LibraryState {
  library: Book[]; // might contain deleted books
  checkOpenWithBooks: boolean;
  checkLastOpenBooks: boolean;
  currentBookshelf: (Book | BooksGroup)[];
  getVisibleLibrary: () => Book[];
  setCheckOpenWithBooks: (check: boolean) => void;
  setCheckLastOpenBooks: (check: boolean) => void;
  setLibrary: (books: Book[]) => void;
  updateBook: (envConfig: EnvConfigType, book: Book) => void;
  setCurrentBookshelf: (bookshelf: (Book | BooksGroup)[]) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: [],
  currentBookshelf: [],
  checkOpenWithBooks: isTauriAppPlatform(),
  checkLastOpenBooks: isTauriAppPlatform(),
  getVisibleLibrary: () => get().library.filter((book) => !book.deletedAt),
  setCurrentBookshelf: (bookshelf: (Book | BooksGroup)[]) => {
    set({ currentBookshelf: bookshelf });
  },
  setCheckOpenWithBooks: (check) => set({ checkOpenWithBooks: check }),
  setCheckLastOpenBooks: (check) => set({ checkLastOpenBooks: check }),
  setLibrary: (books) => set({ library: books }),
  updateBook: async (envConfig: EnvConfigType, book: Book) => {
    const appService = await envConfig.getAppService();
    const { library } = get();
    const bookIndex = library.findIndex((b) => b.hash === book.hash);
    if (bookIndex !== -1) {
      library[bookIndex] = book;
    }
    set({ library: [...library] });
    appService.saveLibraryBooks(library);
  },
}));
