import clsx from 'clsx';
import React from 'react';
import { IoIosList, IoMdCloseCircle } from 'react-icons/io';
import { HiArrowLongLeft, HiArrowLongRight } from 'react-icons/hi2';

import { Insets } from '@/types/misc';
import { BookSearchMatch, BookSearchResult } from '@/types/book';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { useSearchNav } from '../../hooks/useSearchNav';
import { useReaderStore } from '@/store/readerStore';

interface SearchResultsNavProps {
  bookKey: string;
  gridInsets: Insets;
}

const SearchResultsNav: React.FC<SearchResultsNavProps> = ({ bookKey, gridInsets }) => {
  const {
    searchTerm,
    currentSection,
    showSearchNav,
    hasPreviousPage,
    hasNextPage,
    handleShowResults,
    handleCloseSearch,
    handlePreviousResult,
    handleNextResult,
  } = useSearchNav(bookKey);
  const { appService } = useEnv();
  const _ = useTranslation();
  const { getViewSettings } = useReaderStore();
  const viewSettings = getViewSettings(bookKey);
  const iconSize16 = useResponsiveSize(16);
  const iconSize18 = useResponsiveSize(18);
  const iconSize20 = useResponsiveSize(20);

  if (!showSearchNav) {
    return null;
  }

  const showSection = appService?.isMobile || !viewSettings?.showHeader;

  return (
    <div
      className='search-results-nav pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-between px-4 py-1'
      style={{
        top: gridInsets.top,
        right: gridInsets.right,
        bottom: gridInsets.bottom / 4,
        left: gridInsets.left,
      }}
    >
      {/* Top bar: Search info */}
      <div className='bg-base-200/95 pointer-events-auto flex items-center justify-between rounded-xl px-4 py-1 shadow-lg backdrop-blur-sm sm:gap-6'>
        <button
          title={_('Show Search Results')}
          onClick={handleShowResults}
          className='btn btn-ghost h-8 min-h-8 w-8 p-0 hover:bg-transparent'
        >
          <IoIosList size={iconSize20} className='text-base-content' />
        </button>

        <div className='flex flex-1 flex-col items-center px-2'>
          <span className='line-clamp-1 text-sm font-medium'>
            {_("Search results for '{{term}}'", { term: searchTerm })}
          </span>
          {currentSection && showSection && (
            <span className='text-base-content/70 line-clamp-1 text-xs'>{currentSection}</span>
          )}
        </div>

        <button
          title={_('Close Search')}
          onClick={handleCloseSearch}
          className='btn btn-ghost h-8 min-h-8 w-8 p-0 hover:bg-transparent'
        >
          <IoMdCloseCircle size={iconSize16} />
        </button>
      </div>

      {/* Bottom bar: Navigation buttons */}
      <div className='bg-base-200/95 pointer-events-auto flex items-center justify-between gap-6 rounded-xl px-4 py-0 shadow-lg backdrop-blur-sm'>
        <button
          title={_('Previous Result')}
          onClick={handlePreviousResult}
          disabled={!hasPreviousPage}
          className={clsx(
            'btn btn-ghost flex h-auto min-h-0 flex-1 flex-col items-center gap-0 p-1 hover:bg-transparent',
            !hasPreviousPage && 'opacity-40',
          )}
        >
          <HiArrowLongLeft size={iconSize18} className='text-base-content' />
          <span className='text-sm font-medium'>{_('Previous')}</span>
        </button>

        <button
          title={_('Next Result')}
          onClick={handleNextResult}
          disabled={!hasNextPage}
          className={clsx(
            'btn btn-ghost flex h-auto min-h-0 flex-1 flex-col items-center gap-0 p-1 hover:bg-transparent',
            !hasNextPage && 'opacity-40',
          )}
        >
          <HiArrowLongRight size={iconSize18} className='text-base-content' />
          <span className='text-sm font-medium'>{_('Next')}</span>
        </button>
      </div>
    </div>
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
