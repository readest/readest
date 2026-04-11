import { create } from 'zustand';
import { Book, BookGroupType, BooksGroup, ReadingStatus } from '@/types/book';
import { EnvConfigType, isTauriAppPlatform } from '@/services/environment';
import { BOOK_UNGROUPED_NAME } from '@/services/constants';
import { md5Fingerprint } from '@/utils/md5';

interface LibraryState {
  library: Book[]; // might contain deleted books
  libraryLoaded: boolean;
  isSyncing: boolean;
  syncProgress: number;
  checkOpenWithBooks: boolean;
  checkLastOpenBooks: boolean;
  currentBookshelf: (Book | BooksGroup)[];
  selectedBooks: Set<string>; // hashes for books, ids for groups
  groups: Record<string, string>;
  hashIndex: Map<string, number>; // hash -> array index for O(1) lookup
  visibleLibrary: Book[];
  setIsSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: number) => void;
  setSelectedBooks: (ids: string[]) => void;
  getSelectedBooks: () => string[];
  toggleSelectedBook: (id: string) => void;
  getVisibleLibrary: () => Book[];
  getBookByHash: (hash: string) => Book | undefined;
  setCheckOpenWithBooks: (check: boolean) => void;
  setCheckLastOpenBooks: (check: boolean) => void;
  setLibrary: (books: Book[]) => void;
  updateBookProgress: (
    hash: string,
    progress: [number, number],
    readingStatus?: ReadingStatus,
  ) => void;
  updateBook: (envConfig: EnvConfigType, book: Book) => void;
  updateBooks: (envConfig: EnvConfigType, books: Book[]) => void;
  setCurrentBookshelf: (bookshelf: (Book | BooksGroup)[]) => void;
  refreshGroups: () => void;
  rebuildHashIndex: () => void;
  addGroup: (name: string) => BookGroupType;
  getGroups: () => BookGroupType[];
  getGroupId: (path: string) => string | undefined;
  getGroupName: (id: string) => string | undefined;
  getParentPath: (path: string) => string | undefined;
  getGroupsByParent: (parentPath?: string) => BookGroupType[];
}

function buildHashIndex(books: Book[]): Map<string, number> {
  const index = new Map<string, number>();
  for (let i = 0; i < books.length; i++) {
    index.set(books[i]!.hash, i);
  }
  return index;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  library: [],
  libraryLoaded: false,
  isSyncing: false,
  syncProgress: 0,
  currentBookshelf: [],
  selectedBooks: new Set(),
  groups: {},
  hashIndex: new Map(),
  visibleLibrary: [],
  checkOpenWithBooks: isTauriAppPlatform(),
  checkLastOpenBooks: isTauriAppPlatform(),

  setIsSyncing: (syncing: boolean) => set({ isSyncing: syncing }),
  setSyncProgress: (progress: number) => set({ syncProgress: progress }),
  getVisibleLibrary: () => get().visibleLibrary,
  getBookByHash: (hash: string) => {
    const { library, hashIndex } = get();
    const idx = hashIndex.get(hash);
    return idx !== undefined ? library[idx] : undefined;
  },

  setCurrentBookshelf: (bookshelf: (Book | BooksGroup)[]) => {
    set({ currentBookshelf: bookshelf });
  },

  setCheckOpenWithBooks: (check) => set({ checkOpenWithBooks: check }),
  setCheckLastOpenBooks: (check) => set({ checkLastOpenBooks: check }),
  setLibrary: (books) => {
    set({
      library: books,
      libraryLoaded: true,
      hashIndex: buildHashIndex(books),
      visibleLibrary: books.filter((b) => !b.deletedAt),
    });
    get().refreshGroups();
  },

  // Lightweight progress update — no array copy, no refreshGroups
  updateBookProgress: (hash, progress, readingStatus?) => {
    const { library, hashIndex } = get();
    const idx = hashIndex.get(hash);
    if (idx === undefined) return;
    const book = library[idx]!;
    library[idx] = { ...book, progress, readingStatus, updatedAt: Date.now() };
    set({ library });
  },

  rebuildHashIndex: () => {
    set({ hashIndex: buildHashIndex(get().library) });
  },

  updateBook: async (envConfig: EnvConfigType, book: Book) => {
    const appService = await envConfig.getAppService();
    const { library, hashIndex } = get();
    const idx = hashIndex.get(book.hash);
    if (idx !== undefined) {
      library[idx] = book;
    }
    set({
      library: [...library],
      hashIndex: buildHashIndex(library),
      visibleLibrary: library.filter((b) => !b.deletedAt),
    });
    await appService.saveLibraryBooks(library);
  },
  updateBooks: async (envConfig: EnvConfigType, books: Book[]) => {
    if (!books?.length) return;

    const appService = await envConfig.getAppService();
    const { library, refreshGroups } = get();

    const newLibrary = Array.from(new Map([...library, ...books].map((b) => [b.hash, b])).values());
    set({
      library: newLibrary,
      hashIndex: buildHashIndex(newLibrary),
      visibleLibrary: newLibrary.filter((b) => !b.deletedAt),
    });
    refreshGroups();
    await appService.saveLibraryBooks(newLibrary);
  },

  setSelectedBooks: (ids: string[]) => {
    set({ selectedBooks: new Set(ids) });
  },

  getSelectedBooks: () => {
    return Array.from(get().selectedBooks);
  },

  toggleSelectedBook: (id: string) => {
    set((state) => {
      const newSelection = new Set(state.selectedBooks);
      if (newSelection.has(id)) {
        newSelection.delete(id);
      } else {
        newSelection.add(id);
      }
      return { selectedBooks: newSelection };
    });
  },

  refreshGroups: () => {
    const { library } = get();
    const groups: Record<string, string> = {};

    library.forEach((book) => {
      if (book.groupName && book.groupName !== BOOK_UNGROUPED_NAME && !book.deletedAt) {
        groups[md5Fingerprint(book.groupName)] = book.groupName;
        let nextSlashIndex = book.groupName.indexOf('/', 0);
        while (nextSlashIndex > 0) {
          const groupName = book.groupName.substring(0, nextSlashIndex);
          groups[md5Fingerprint(groupName)] = groupName;
          nextSlashIndex = book.groupName.indexOf('/', nextSlashIndex + 1);
        }
      }
    });

    set({ groups });
  },

  addGroup: (name: string) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('Group name cannot be empty');
    }

    const id = md5Fingerprint(trimmedName);
    const { groups } = get();

    set({ groups: { ...groups, [id]: trimmedName } });

    return { id, name: trimmedName };
  },

  getGroups: () => {
    const { groups } = get();
    return Object.entries(groups)
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },

  getGroupId: (path: string) => {
    const { groups } = get();

    const directId = Object.entries(groups).find(([_, name]) => name === path)?.[0];
    if (directId) {
      return directId;
    }

    return md5Fingerprint(path);
  },

  getGroupName: (id: string) => {
    return get().groups[id];
  },

  getParentPath: (path: string) => {
    const lastSlashIndex = path.lastIndexOf('/');
    if (lastSlashIndex === -1) return '';
    return path.slice(0, lastSlashIndex);
  },

  getGroupsByParent: (parentPath?: string) => {
    const { groups } = get();
    const result: BookGroupType[] = [];
    Object.entries(groups).forEach(([id, name]) => {
      const groupParentPath = get().getParentPath(name);
      if (groupParentPath === (parentPath || '')) {
        result.push({ id, name });
      }
    });
    return result;
  },
}));
