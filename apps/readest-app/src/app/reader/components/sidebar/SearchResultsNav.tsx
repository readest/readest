import React from 'react';

import { Insets } from '@/types/misc';
import { BookSearchMatch, BookSearchResult } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useSearchNav } from '../../hooks/useSearchNav';
import ContentNavBar from './ContentNavBar';

interface SearchResultsNavProps {
  bookKey: string;
  gridInsets: Insets;
}

const SearchResultsNav: React.FC<SearchResultsNavProps> = ({ bookKey, gridInsets }) => {
  const {
    searchTerm,
    searchProgress,
    currentSection,
    showSearchNav,
    hasPreviousPage,
    hasNextPage,
    handleShowResults,
    handleCloseSearch,
    handlePreviousResult,
    handleNextResult,
  } = useSearchNav(bookKey);
  const _ = useTranslation();

  if (!showSearchNav) {
    return null;
  }

  return (
    <ContentNavBar
      bookKey={bookKey}
      gridInsets={gridInsets}
      title={_("Search results for '{{term}}'", { term: searchTerm })}
      section={currentSection}
      progress={searchProgress}
      hasPrevious={hasPreviousPage}
      hasNext={hasNextPage}
      previousTitle={_('Previous Result')}
      nextTitle={_('Next Result')}
      showResultsTitle={_('Show Search Results')}
      closeTitle={_('Close Search')}
      onShowResults={handleShowResults}
      onClose={handleCloseSearch}
      onPrevious={handlePreviousResult}
      onNext={handleNextResult}
    />
  );
};

export default SearchResultsNav;

// Helper function to flatten search results into a single array of matches with section labels
export function flattenSearchResults(
  results: BookSearchResult[] | BookSearchMatch[],
): { cfi: string; sectionLabel: string }[] {
  const flattened: { cfi: string; sectionLabel: string }[] = [];

  for (const result of results) {
    if ('subitems' in result) {
      // BookSearchResult with subitems
      for (const item of result.subitems) {
        flattened.push({ cfi: item.cfi, sectionLabel: result.label });
      }
    } else {
      // BookSearchMatch
      flattened.push({ cfi: result.cfi, sectionLabel: '' });
    }
  }

  return flattened;
}

// Helper function to find the index of current result based on CFI
export function findCurrentResultIndex(
  flattenedResults: { cfi: string; sectionLabel: string }[],
  currentLocation: string | undefined,
): number {
  if (!currentLocation || flattenedResults.length === 0) return 0;

  // Try to find exact match or closest match
  for (let i = 0; i < flattenedResults.length; i++) {
    if (flattenedResults[i]!.cfi === currentLocation) {
      return i;
    }
  }

  return 0;
}
