import { create } from 'zustand';
import { BookNote, BookNoteType, BookSearchMatch, BookSearchResult } from '@/types/book';

type SearchStatus = 'searching' | 'completed' | 'terminated';

// Per-book search navigation state
interface SearchNavState {
  searchTerm: string;
  searchResults: BookSearchResult[] | BookSearchMatch[] | null;
  searchResultIndex: number;
  searchProgress: number; // 0 to 1, where 1 means search complete
}

// Per-book booknotes navigation state
interface BooknotesNavState {
  activeBooknoteType: BookNoteType | null;
  booknoteResults: BookNote[] | null;
  booknoteIndex: number;
}

interface SidebarState {
  sideBarBookKey: string | null;
  sideBarWidth: string;
  isSideBarVisible: boolean;
  isSideBarPinned: boolean;
  // Per-book navigation states
  searchNavStates: Record<string, SearchNavState>;
  booknotesNavStates: Record<string, BooknotesNavState>;
  searchStatuses: Record<string, SearchStatus>;
  getIsSideBarVisible: () => boolean;
  getSideBarWidth: () => string;
  setSideBarBookKey: (key: string) => void;
  setSideBarWidth: (width: string) => void;
  toggleSideBar: () => void;
  toggleSideBarPin: () => void;
  setSideBarVisible: (visible: boolean) => void;
  setSideBarPin: (pinned: boolean) => void;
  // Search actions (per bookKey)
  getSearchNavState: (bookKey: string) => SearchNavState;
  setSearchTerm: (bookKey: string, term: string) => void;
  setSearchStatus: (bookKey: string, status: SearchStatus) => void;
  getSearchStatus: (bookKey: string) => SearchStatus | null;
  setSearchResults: (
    bookKey: string,
    results: BookSearchResult[] | BookSearchMatch[] | null,
  ) => void;
  setSearchResultIndex: (bookKey: string, index: number) => void;
  setSearchProgress: (bookKey: string, progress: number) => void;
  clearSearch: (bookKey: string) => void;
  // Booknotes navigation actions (per bookKey)
  getBooknotesNavState: (bookKey: string) => BooknotesNavState;
  setActiveBooknoteType: (bookKey: string, type: BookNoteType | null) => void;
  setBooknoteResults: (bookKey: string, results: BookNote[] | null) => void;
  setBooknoteIndex: (bookKey: string, index: number) => void;
  clearBooknotesNav: (bookKey: string) => void;
}

const defaultSearchNavState: SearchNavState = {
  searchTerm: '',
  searchResults: null,
  searchResultIndex: 0,
  searchProgress: 1,
};

const defaultBooknotesNavState: BooknotesNavState = {
  activeBooknoteType: null,
  booknoteResults: null,
  booknoteIndex: 0,
};

export const useSidebarStore = create<SidebarState>((set, get) => ({
  sideBarBookKey: null,
  sideBarWidth: '',
  isSideBarVisible: false,
  isSideBarPinned: false,
  // Per-book navigation states
  searchNavStates: {},
  booknotesNavStates: {},
  searchStatuses: {},
  getIsSideBarVisible: () => get().isSideBarVisible,
  getSideBarWidth: () => get().sideBarWidth,
  setSideBarBookKey: (key: string) => set({ sideBarBookKey: key }),
  setSideBarWidth: (width: string) => set({ sideBarWidth: width }),
  toggleSideBar: () => set((state) => ({ isSideBarVisible: !state.isSideBarVisible })),
  toggleSideBarPin: () => set((state) => ({ isSideBarPinned: !state.isSideBarPinned })),
  setSideBarVisible: (visible: boolean) => set({ isSideBarVisible: visible }),
  setSideBarPin: (pinned: boolean) => set({ isSideBarPinned: pinned }),
  // Search actions
  getSearchStatus: (bookKey: string) => {
    return get().searchStatuses[bookKey] || null;
  },
  getSearchNavState: (bookKey: string) => {
    return get().searchNavStates[bookKey] || defaultSearchNavState;
  },
  setSearchTerm: (bookKey: string, term: string) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchTerm: term,
        },
      },
    })),
  setSearchResults: (bookKey: string, results: BookSearchResult[] | BookSearchMatch[] | null) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchResults: results,
        },
      },
    })),
  setSearchResultIndex: (bookKey: string, index: number) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchResultIndex: index,
        },
      },
    })),
  setSearchProgress: (bookKey: string, progress: number) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: {
          ...(state.searchNavStates[bookKey] || defaultSearchNavState),
          searchProgress: progress,
        },
      },
    })),
  clearSearch: (bookKey: string) =>
    set((state) => ({
      searchNavStates: {
        ...state.searchNavStates,
        [bookKey]: { ...defaultSearchNavState },
      },
      searchStatuses: {
        ...state.searchStatuses,
        [bookKey]: 'terminated',
      },
    })),
  setSearchStatus: (bookKey: string, status: SearchStatus) =>
    set((state) => ({
      searchStatuses: {
        ...state.searchStatuses,
        [bookKey]: status,
      },
    })),
  // Booknotes navigation actions
  getBooknotesNavState: (bookKey: string) => {
    return get().booknotesNavStates[bookKey] || defaultBooknotesNavState;
  },
  setActiveBooknoteType: (bookKey: string, type: BookNoteType | null) =>
    set((state) => ({
      booknotesNavStates: {
        ...state.booknotesNavStates,
        [bookKey]: {
          ...(state.booknotesNavStates[bookKey] || defaultBooknotesNavState),
          activeBooknoteType: type,
        },
      },
    })),
  setBooknoteResults: (bookKey: string, results: BookNote[] | null) =>
    set((state) => ({
      booknotesNavStates: {
        ...state.booknotesNavStates,
        [bookKey]: {
          ...(state.booknotesNavStates[bookKey] || defaultBooknotesNavState),
          booknoteResults: results,
        },
      },
    })),
  setBooknoteIndex: (bookKey: string, index: number) =>
    set((state) => ({
      booknotesNavStates: {
        ...state.booknotesNavStates,
        [bookKey]: {
          ...(state.booknotesNavStates[bookKey] || defaultBooknotesNavState),
          booknoteIndex: index,
        },
      },
    })),
  clearBooknotesNav: (bookKey: string) =>
    set((state) => ({
      booknotesNavStates: {
        ...state.booknotesNavStates,
        [bookKey]: { ...defaultBooknotesNavState },
      },
    })),
}));
