import { describe, test, expect, beforeEach } from 'vitest';
import { useSidebarStore } from '@/store/sidebarStore';
import { BookNote, BookNoteType, BookSearchResult } from '@/types/book';

beforeEach(() => {
  useSidebarStore.setState({
    sideBarBookKey: null,
    sideBarWidth: '',
    isSideBarVisible: false,
    isSideBarPinned: false,
    searchNavStates: {},
    booknotesNavStates: {},
    searchStatuses: {},
  });
});

describe('sidebarStore', () => {
  // ── Basic sidebar state ──────────────────────────────────────────
  describe('toggleSideBar', () => {
    test('toggles visibility from false to true', () => {
      useSidebarStore.getState().toggleSideBar();
      expect(useSidebarStore.getState().isSideBarVisible).toBe(true);
    });

    test('toggles visibility from true to false', () => {
      useSidebarStore.getState().setSideBarVisible(true);
      useSidebarStore.getState().toggleSideBar();
      expect(useSidebarStore.getState().isSideBarVisible).toBe(false);
    });
  });

  describe('toggleSideBarPin', () => {
    test('toggles pin from false to true', () => {
      useSidebarStore.getState().toggleSideBarPin();
      expect(useSidebarStore.getState().isSideBarPinned).toBe(true);
    });

    test('toggles pin from true to false', () => {
      useSidebarStore.getState().setSideBarPin(true);
      useSidebarStore.getState().toggleSideBarPin();
      expect(useSidebarStore.getState().isSideBarPinned).toBe(false);
    });
  });

  describe('setSideBarVisible', () => {
    test('sets visibility to true', () => {
      useSidebarStore.getState().setSideBarVisible(true);
      expect(useSidebarStore.getState().isSideBarVisible).toBe(true);
    });

    test('sets visibility to false', () => {
      useSidebarStore.getState().setSideBarVisible(true);
      useSidebarStore.getState().setSideBarVisible(false);
      expect(useSidebarStore.getState().isSideBarVisible).toBe(false);
    });
  });

  describe('setSideBarPin', () => {
    test('sets pinned to true', () => {
      useSidebarStore.getState().setSideBarPin(true);
      expect(useSidebarStore.getState().isSideBarPinned).toBe(true);
    });

    test('sets pinned to false', () => {
      useSidebarStore.getState().setSideBarPin(true);
      useSidebarStore.getState().setSideBarPin(false);
      expect(useSidebarStore.getState().isSideBarPinned).toBe(false);
    });
  });

  describe('setSideBarWidth', () => {
    test('sets the sidebar width', () => {
      useSidebarStore.getState().setSideBarWidth('300px');
      expect(useSidebarStore.getState().sideBarWidth).toBe('300px');
    });
  });

  describe('setSideBarBookKey', () => {
    test('sets the active book key', () => {
      useSidebarStore.getState().setSideBarBookKey('book-abc');
      expect(useSidebarStore.getState().sideBarBookKey).toBe('book-abc');
    });
  });

  describe('getIsSideBarVisible / getSideBarWidth', () => {
    test('getIsSideBarVisible returns current visibility', () => {
      expect(useSidebarStore.getState().getIsSideBarVisible()).toBe(false);
      useSidebarStore.getState().setSideBarVisible(true);
      expect(useSidebarStore.getState().getIsSideBarVisible()).toBe(true);
    });

    test('getSideBarWidth returns current width', () => {
      expect(useSidebarStore.getState().getSideBarWidth()).toBe('');
      useSidebarStore.getState().setSideBarWidth('250px');
      expect(useSidebarStore.getState().getSideBarWidth()).toBe('250px');
    });
  });

  // ── Per-book search state ────────────────────────────────────────
  describe('setSearchTerm', () => {
    test('sets search term for a book', () => {
      useSidebarStore.getState().setSearchTerm('book1', 'hello');
      const nav = useSidebarStore.getState().getSearchNavState('book1');
      expect(nav.searchTerm).toBe('hello');
    });
  });

  describe('setSearchResults', () => {
    test('sets search results for a book', () => {
      const results: BookSearchResult[] = [
        {
          label: 'Ch1',
          subitems: [{ cfi: 'cfi1', excerpt: { pre: '', match: 'hello', post: '' } }],
        },
      ];
      useSidebarStore.getState().setSearchResults('book1', results);
      const nav = useSidebarStore.getState().getSearchNavState('book1');
      expect(nav.searchResults).toEqual(results);
    });

    test('sets search results to null', () => {
      useSidebarStore.getState().setSearchResults('book1', null);
      const nav = useSidebarStore.getState().getSearchNavState('book1');
      expect(nav.searchResults).toBeNull();
    });
  });

  describe('setSearchResultIndex', () => {
    test('sets search result index for a book', () => {
      useSidebarStore.getState().setSearchResultIndex('book1', 5);
      const nav = useSidebarStore.getState().getSearchNavState('book1');
      expect(nav.searchResultIndex).toBe(5);
    });
  });

  describe('setSearchProgress', () => {
    test('sets search progress for a book', () => {
      useSidebarStore.getState().setSearchProgress('book1', 0.5);
      const nav = useSidebarStore.getState().getSearchNavState('book1');
      expect(nav.searchProgress).toBe(0.5);
    });
  });

  describe('clearSearch', () => {
    test('resets search state to defaults for a book', () => {
      useSidebarStore.getState().setSearchTerm('book1', 'hello');
      useSidebarStore.getState().setSearchResultIndex('book1', 3);
      useSidebarStore.getState().setSearchProgress('book1', 0.8);

      useSidebarStore.getState().clearSearch('book1');
      const nav = useSidebarStore.getState().getSearchNavState('book1');
      expect(nav.searchTerm).toBe('');
      expect(nav.searchResults).toBeNull();
      expect(nav.searchResultIndex).toBe(0);
      expect(nav.searchProgress).toBe(1);
    });

    test('sets search status to terminated', () => {
      useSidebarStore.getState().setSearchStatus('book1', 'searching');
      useSidebarStore.getState().clearSearch('book1');
      expect(useSidebarStore.getState().getSearchStatus('book1')).toBe('terminated');
    });
  });

  describe('getSearchNavState', () => {
    test('returns default state for unknown book key', () => {
      const nav = useSidebarStore.getState().getSearchNavState('unknown-book');
      expect(nav.searchTerm).toBe('');
      expect(nav.searchResults).toBeNull();
      expect(nav.searchResultIndex).toBe(0);
      expect(nav.searchProgress).toBe(1);
    });
  });

  describe('setSearchStatus / getSearchStatus', () => {
    test('sets and gets search status', () => {
      useSidebarStore.getState().setSearchStatus('book1', 'searching');
      expect(useSidebarStore.getState().getSearchStatus('book1')).toBe('searching');

      useSidebarStore.getState().setSearchStatus('book1', 'completed');
      expect(useSidebarStore.getState().getSearchStatus('book1')).toBe('completed');
    });

    test('returns null for unknown book key', () => {
      expect(useSidebarStore.getState().getSearchStatus('unknown')).toBeNull();
    });
  });

  // ── Per-book booknotes state ─────────────────────────────────────
  describe('setActiveBooknoteType', () => {
    test('sets active booknote type for a book', () => {
      const noteType: BookNoteType = 'annotation';
      useSidebarStore.getState().setActiveBooknoteType('book1', noteType);
      const nav = useSidebarStore.getState().getBooknotesNavState('book1');
      expect(nav.activeBooknoteType).toBe('annotation');
    });

    test('sets active booknote type to null', () => {
      useSidebarStore.getState().setActiveBooknoteType('book1', 'bookmark');
      useSidebarStore.getState().setActiveBooknoteType('book1', null);
      const nav = useSidebarStore.getState().getBooknotesNavState('book1');
      expect(nav.activeBooknoteType).toBeNull();
    });
  });

  describe('setBooknoteResults', () => {
    test('sets booknote results for a book', () => {
      const notes: BookNote[] = [
        {
          id: 'n1',
          type: 'bookmark',
          cfi: 'cfi1',
          note: 'test',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ];
      useSidebarStore.getState().setBooknoteResults('book1', notes);
      const nav = useSidebarStore.getState().getBooknotesNavState('book1');
      expect(nav.booknoteResults).toEqual(notes);
    });

    test('sets booknote results to null', () => {
      useSidebarStore.getState().setBooknoteResults('book1', null);
      const nav = useSidebarStore.getState().getBooknotesNavState('book1');
      expect(nav.booknoteResults).toBeNull();
    });
  });

  describe('setBooknoteIndex', () => {
    test('sets booknote index for a book', () => {
      useSidebarStore.getState().setBooknoteIndex('book1', 7);
      const nav = useSidebarStore.getState().getBooknotesNavState('book1');
      expect(nav.booknoteIndex).toBe(7);
    });
  });

  describe('clearBooknotesNav', () => {
    test('resets booknotes nav state to defaults for a book', () => {
      useSidebarStore.getState().setActiveBooknoteType('book1', 'annotation');
      useSidebarStore.getState().setBooknoteIndex('book1', 5);
      const notes: BookNote[] = [
        {
          id: 'n1',
          type: 'bookmark',
          cfi: 'cfi1',
          note: 'test',
          createdAt: 1000,
          updatedAt: 1000,
        },
      ];
      useSidebarStore.getState().setBooknoteResults('book1', notes);

      useSidebarStore.getState().clearBooknotesNav('book1');
      const nav = useSidebarStore.getState().getBooknotesNavState('book1');
      expect(nav.activeBooknoteType).toBeNull();
      expect(nav.booknoteResults).toBeNull();
      expect(nav.booknoteIndex).toBe(0);
    });
  });

  describe('getBooknotesNavState', () => {
    test('returns default state for unknown book key', () => {
      const nav = useSidebarStore.getState().getBooknotesNavState('unknown-book');
      expect(nav.activeBooknoteType).toBeNull();
      expect(nav.booknoteResults).toBeNull();
      expect(nav.booknoteIndex).toBe(0);
    });
  });

  // ── Per-book state isolation ─────────────────────────────────────
  describe('per-book state isolation', () => {
    test('search state for different books is independent', () => {
      useSidebarStore.getState().setSearchTerm('book1', 'alpha');
      useSidebarStore.getState().setSearchTerm('book2', 'beta');
      useSidebarStore.getState().setSearchResultIndex('book1', 3);
      useSidebarStore.getState().setSearchProgress('book2', 0.5);

      const nav1 = useSidebarStore.getState().getSearchNavState('book1');
      const nav2 = useSidebarStore.getState().getSearchNavState('book2');

      expect(nav1.searchTerm).toBe('alpha');
      expect(nav2.searchTerm).toBe('beta');
      expect(nav1.searchResultIndex).toBe(3);
      expect(nav2.searchResultIndex).toBe(0);
      expect(nav1.searchProgress).toBe(1); // default
      expect(nav2.searchProgress).toBe(0.5);
    });

    test('clearing search for one book does not affect another', () => {
      useSidebarStore.getState().setSearchTerm('book1', 'alpha');
      useSidebarStore.getState().setSearchTerm('book2', 'beta');

      useSidebarStore.getState().clearSearch('book1');

      const nav1 = useSidebarStore.getState().getSearchNavState('book1');
      const nav2 = useSidebarStore.getState().getSearchNavState('book2');
      expect(nav1.searchTerm).toBe('');
      expect(nav2.searchTerm).toBe('beta');
    });

    test('booknotes state for different books is independent', () => {
      useSidebarStore.getState().setActiveBooknoteType('book1', 'bookmark');
      useSidebarStore.getState().setActiveBooknoteType('book2', 'annotation');
      useSidebarStore.getState().setBooknoteIndex('book1', 2);
      useSidebarStore.getState().setBooknoteIndex('book2', 8);

      const nav1 = useSidebarStore.getState().getBooknotesNavState('book1');
      const nav2 = useSidebarStore.getState().getBooknotesNavState('book2');

      expect(nav1.activeBooknoteType).toBe('bookmark');
      expect(nav2.activeBooknoteType).toBe('annotation');
      expect(nav1.booknoteIndex).toBe(2);
      expect(nav2.booknoteIndex).toBe(8);
    });

    test('clearing booknotes for one book does not affect another', () => {
      useSidebarStore.getState().setActiveBooknoteType('book1', 'bookmark');
      useSidebarStore.getState().setActiveBooknoteType('book2', 'annotation');

      useSidebarStore.getState().clearBooknotesNav('book1');

      const nav1 = useSidebarStore.getState().getBooknotesNavState('book1');
      const nav2 = useSidebarStore.getState().getBooknotesNavState('book2');
      expect(nav1.activeBooknoteType).toBeNull();
      expect(nav2.activeBooknoteType).toBe('annotation');
    });

    test('search status for different books is independent', () => {
      useSidebarStore.getState().setSearchStatus('book1', 'searching');
      useSidebarStore.getState().setSearchStatus('book2', 'completed');

      expect(useSidebarStore.getState().getSearchStatus('book1')).toBe('searching');
      expect(useSidebarStore.getState().getSearchStatus('book2')).toBe('completed');
    });
  });
});
