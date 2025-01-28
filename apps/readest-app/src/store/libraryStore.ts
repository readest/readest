import { create } from 'zustand';
import { Book } from '@/types/book';
import { EnvConfigType } from '@/services/environment';

interface LibraryState {
  library: Book[];
  checkOpenWithBooks: boolean;
  clearOpenWithBooks: () => void;
  setLibrary: (books: Book[]) => void;
  updateBook: (envConfig: EnvConfigType, book: Book, isDelete?: boolean) => void;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: [],
  checkOpenWithBooks: true,
  clearOpenWithBooks: () => set({ checkOpenWithBooks: false }),
  setLibrary: (books) => set({ library: books }),
  updateBook: async (envConfig: EnvConfigType, book: Book, isDelete = false) => {
    const appService = await envConfig.getAppService();
    const { library } = get();
    const bookIndex = library.findIndex((b) => b.hash === book.hash);
    if (bookIndex !== -1) {
      if (isDelete) {
        appService.deleteBook(book, !!book.uploadedAt);
        book.deletedAt = Date.now();
        book.uploadedAt = null;
        book.downloadedAt = null;
      } else {
        library[bookIndex] = book;
      }
    }
    set({ library });
    appService.saveLibraryBooks(library);
  },
}));
