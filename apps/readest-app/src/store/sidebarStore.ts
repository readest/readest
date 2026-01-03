import { create } from 'zustand';
import { BookSearchResult } from '@/types/book';

interface SidebarState {
  sideBarBookKey: string | null;
  sideBarWidth: string;
  isSideBarVisible: boolean;
  isSideBarPinned: boolean;
  // Search state
  searchTerm: string;
  searchResults: BookSearchResult[] | null;
  searchResultIndex: number;
  getIsSideBarVisible: () => boolean;
  getSideBarWidth: () => string;
  setSideBarBookKey: (key: string) => void;
  setSideBarWidth: (width: string) => void;
  toggleSideBar: () => void;
  toggleSideBarPin: () => void;
  setSideBarVisible: (visible: boolean) => void;
  setSideBarPin: (pinned: boolean) => void;
  // Search actions
  setSearchTerm: (term: string) => void;
  setSearchResults: (results: BookSearchResult[] | null) => void;
  setSearchResultIndex: (index: number) => void;
  clearSearch: () => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  sideBarBookKey: null,
  sideBarWidth: '',
  isSideBarVisible: false,
  isSideBarPinned: false,
  // Search state
  searchTerm: '',
  searchResults: null,
  searchResultIndex: 0,
  getIsSideBarVisible: () => get().isSideBarVisible,
  getSideBarWidth: () => get().sideBarWidth,
  setSideBarBookKey: (key: string) => set({ sideBarBookKey: key }),
  setSideBarWidth: (width: string) => set({ sideBarWidth: width }),
  toggleSideBar: () => set((state) => ({ isSideBarVisible: !state.isSideBarVisible })),
  toggleSideBarPin: () => set((state) => ({ isSideBarPinned: !state.isSideBarPinned })),
  setSideBarVisible: (visible: boolean) => set({ isSideBarVisible: visible }),
  setSideBarPin: (pinned: boolean) => set({ isSideBarPinned: pinned }),
  // Search actions
  setSearchTerm: (term: string) => set({ searchTerm: term }),
  setSearchResults: (results: BookSearchResult[] | null) => set({ searchResults: results }),
  setSearchResultIndex: (index: number) => set({ searchResultIndex: index }),
  clearSearch: () => set({ searchTerm: '', searchResults: null, searchResultIndex: 0 }),
}));
