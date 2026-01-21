import { useCallback, useMemo } from 'react';
import { useSidebarStore } from '@/store/sidebarStore';
import { useReaderStore } from '@/store/readerStore';
import { isCfiInLocation } from '@/utils/cfi';
import { flattenSearchResults } from '../components/sidebar/SearchResultsNav';

export function useSearchNav(bookKey: string) {
  const { getView, getProgress } = useReaderStore();
  const { setSideBarVisible } = useSidebarStore();
  const { getSearchNavState, setSearchResultIndex, clearSearch } = useSidebarStore();

  const searchNavState = getSearchNavState(bookKey);
  const { searchTerm, searchResults, searchResultIndex, searchProgress } = searchNavState;

  const progress = getProgress(bookKey);

  const currentLocation = useMemo(() => {
    return progress?.location;
  }, [progress]);

  // Flatten search results for navigation
  const flattenedResults = useMemo(() => {
    if (!searchResults) return [];
    return flattenSearchResults(searchResults);
  }, [searchResults]);

  const totalResults = flattenedResults.length;
  const hasSearchResults = searchResults && totalResults > 0;
  const showSearchNav = hasSearchResults;

  // Get current section label
  const currentSection = useMemo(() => {
    if (!flattenedResults.length || searchResultIndex >= flattenedResults.length) return '';
    return flattenedResults[searchResultIndex]?.sectionLabel || '';
  }, [flattenedResults, searchResultIndex]);

  // Find results on the current page
  const currentPageResults = useMemo(() => {
    if (!flattenedResults.length || !currentLocation) return { firstIndex: -1, lastIndex: -1 };

    let firstIndex = -1;
    let lastIndex = -1;

    for (let i = 0; i < flattenedResults.length; i++) {
      const result = flattenedResults[i];
      if (result && isCfiInLocation(result.cfi, currentLocation)) {
        if (firstIndex === -1) firstIndex = i;
        lastIndex = i;
      }
    }
    if (firstIndex !== -1) {
      setTimeout(() => setSearchResultIndex(bookKey, firstIndex), 0);
    }

    return { firstIndex, lastIndex };
  }, [flattenedResults, currentLocation, bookKey, setSearchResultIndex]);

  // Navigate to a specific search result
  const navigateToResult = useCallback(
    (index: number) => {
      if (!flattenedResults.length) return;
      if (index < 0 || index >= flattenedResults.length) return;

      const result = flattenedResults[index];
      if (result) {
        setSearchResultIndex(bookKey, index);
        getView(bookKey)?.goTo(result.cfi);
      }
    },
    [bookKey, flattenedResults, setSearchResultIndex, getView],
  );

  const handleShowResults = useCallback(() => {
    setSideBarVisible(true);
  }, [setSideBarVisible]);

  const handleCloseSearch = useCallback(() => {
    clearSearch(bookKey);
    getView(bookKey)?.clearSearch();
  }, [clearSearch, bookKey, getView]);

  // Navigate to the previous page with results (last result before current page)
  const handlePreviousResult = useCallback(() => {
    const { firstIndex } = currentPageResults;

    if (firstIndex > 0) {
      // Navigate to the result just before the first result on current page
      navigateToResult(firstIndex - 1);
    } else if (firstIndex === -1 && searchResultIndex > 0) {
      // No results on current page, just go to previous result
      navigateToResult(searchResultIndex - 1);
    }
  }, [currentPageResults, searchResultIndex, navigateToResult]);

  // Navigate to the next page with results (first result after current page)
  const handleNextResult = useCallback(() => {
    const { lastIndex } = currentPageResults;

    if (lastIndex >= 0 && lastIndex < totalResults - 1) {
      // Navigate to the result just after the last result on current page
      navigateToResult(lastIndex + 1);
    } else if (lastIndex === -1 && searchResultIndex < totalResults - 1) {
      // No results on current page, just go to next result
      navigateToResult(searchResultIndex + 1);
    }
  }, [currentPageResults, totalResults, searchResultIndex, navigateToResult]);

  // Check if there are results before/after the current page
  const hasPreviousPage =
    currentPageResults.firstIndex > 0 ||
    (currentPageResults.firstIndex === -1 && searchResultIndex > 0);
  const hasNextPage =
    (currentPageResults.lastIndex >= 0 && currentPageResults.lastIndex < totalResults - 1) ||
    (currentPageResults.lastIndex === -1 && searchResultIndex < totalResults - 1);

  return {
    searchTerm,
    searchProgress,
    currentSection,
    searchResultIndex,
    totalResults,
    showSearchNav,
    hasPreviousPage,
    hasNextPage,
    handleShowResults,
    handleCloseSearch,
    handlePreviousResult,
    handleNextResult,
  };
}
