'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useLibraryStore } from '@/store/libraryStore';
import { eventDispatcher } from '@/utils/event';
import {
  IoSearch,
  IoClose,
  IoFilter,
  IoOptions,
  IoDownload,
  IoPlay,
  IoBook,
  IoDocumentText,
  IoGlobe,
  IoLockOpen,
  IoInfinite,
  IoRefresh,
  IoStop,
  IoChevronDown,
  IoChevronUp,
} from 'react-icons/io5';
import { SourceProviderType, UnifiedSearchQuery, SourceSearchResult, SearchProgress } from '@/types/sources';
import {
  initializeSources,
  searchWithProgress,
  cancelSearches,
  getRateLimiterStatus,
  getEnabledSources,
  resolveDOI,
} from '@/services/sources/sourcesService';
import { downloadQueue } from '@/services/sources/downloadQueue';
import { getProviderIcon, getSourceTypeColor, getSourceTypeBadgeColor } from '@/components/sources/SourceIcons';
import SourceFilter from '@/components/sources/SourceFilter';
import SearchResultCard from '@/components/sources/SearchResultCard';
import SearchProgressPanel from '@/components/sources/SearchProgressPanel';
import RateLimitStatus from '@/components/sources/RateLimitStatus';
import DownloadQueuePanel from '@/components/sources/DownloadQueuePanel';
import LibGenFilters, { LibGenFilterState } from '@/components/sources/LibGenFilters';
import LibGenResultTable from '@/components/sources/LibGenResultTable';

/**
 * Sources Page
 * 
 * Unified search across all library sources (OPDS + Shadow Libraries)
 * with rate limiting and progress tracking.
 */
export default function SourcesPage() {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { library: libraryBooks, setLibrary } = useLibraryStore();

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [doiQuery, setDoiQuery] = useState('');
  const [isbnQuery, setIsbnQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SourceSearchResult[]>([]);
  const [searchProgress, setSearchProgress] = useState<SearchProgress[]>([]);
  
  // Filter state
  const [showFilters, setShowFilters] = useState(false);
  const [selectedSourceTypes, setSelectedSourceTypes] = useState<SourceProviderType[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [excludedSources, setExcludedSources] = useState<string[]>([]);

  // LibGen-specific filter state (when LibGen is only source)
  const [showLibGenFilters, setShowLibGenFilters] = useState(false);
  const [libGenFilters, setLibGenFilters] = useState<LibGenFilterState>({
    searchTitle: true,
    searchAuthor: true,
    searchSeries: true,
    searchYear: true,
    searchPublisher: true,
    searchISBN: true,
    searchFiles: true,
    searchEditions: true,
    searchSeriesObj: true,
    searchAuthors: true,
    searchPublishers: true,
    searchWorks: true,
    topicLibgen: true,
    topicComics: false,
    topicFiction: false,
    topicScientificArticles: false,
    topicMagazines: false,
    topicFictionRUS: false,
    topicStandards: false,
    resultsPerPage: 25,
    showCovers: true,
    showChapters: true,
    googleMode: false,
    filesUns: 'all',
    language: '',
    extensions: {
      pdf: true,
      epub: true,
      fb2: true,
      cbz: false,
      djvu: true,
      mobi: true,
    },
  });
  const [libGenTab, setLibGenTab] = useState('files');
  
  // LibGen table sorting state
  const [libGenSortField, setLibGenSortField] = useState('id');
  const [libGenSortDirection, setLibGenSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // LibGen pagination state
  const [libGenCurrentPage, setLibGenCurrentPage] = useState(1);
  const [libGenTotalPages, setLibGenTotalPages] = useState(25);
  
  // Settings
  const [autoSearch, setAutoSearch] = useState(true);
  const [preferOpenAccess, setPreferOpenAccess] = useState(true);
  
  // Rate limiter status
  const [rateLimitStatus, setRateLimitStatus] = useState<any>(null);
  
  // Initialize
  useEffect(() => {
    initializeSources();
    
    // Update rate limit status periodically
    const interval = setInterval(() => {
      setRateLimitStatus(getRateLimiterStatus());
    }, 1000);
    
    return () => clearInterval(interval);
  }, []);

  // Handle search
  const handleSearch = useCallback(async () => {
    if (!searchQuery && !doiQuery && !isbnQuery) {
      return;
    }

    setIsSearching(true);
    setSearchResults([]);
    setSearchProgress([]);

    // For LibGen, we handle pagination internally (fetches multiple pages)
    // So we always start from page 1
    setLibGenCurrentPage(1);

    const query: UnifiedSearchQuery = {
      query: searchQuery || undefined,
      doi: doiQuery || undefined,
      isbn: isbnQuery || undefined,
      sourceTypes: selectedSourceTypes.length > 0 ? selectedSourceTypes : undefined,
      sourceIds: selectedSources.length > 0 ? selectedSources : undefined,
      excludeSourceIds: excludedSources.length > 0 ? excludedSources : undefined,
      limit: 50,
      timeout: 15000,
    };

    try {
      const { results, progress } = await searchWithProgress(query, (currentProgress) => {
        setSearchProgress([...currentProgress]);
      });

      setSearchResults(results);
      // Estimate total pages (25 results per page)
      setLibGenTotalPages(Math.ceil(results.length / 25));
    } catch (error) {
      console.error('Search failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [searchQuery, doiQuery, isbnQuery, selectedSourceTypes, selectedSources, excludedSources]);

  // Handle DOI resolution
  const handleResolveDOI = useCallback(async () => {
    if (!doiQuery) return;

    setIsSearching(true);
    try {
      const result = await resolveDOI(doiQuery);
      if (result) {
        setSearchResults([result]);
      } else {
        setSearchResults([]);
      }
    } catch (error) {
      console.error('DOI resolution failed:', error);
    } finally {
      setIsSearching(false);
    }
  }, [doiQuery]);

  // Handle cancel
  const handleCancel = useCallback(() => {
    cancelSearches();
    setIsSearching(false);
  }, []);

  // Handle download result
  const handleDownload = useCallback(async (result: SourceSearchResult) => {
    try {
      await downloadQueue.addDownload(result, {
        onComplete: async (file: File) => {
          if (!appService) return;
          try {
            const imported = await appService.importBook(file, libraryBooks);
            if (imported) {
              // Refresh library list in store
              const newLibrary = await appService.loadLibraryBooks();
              setLibrary(newLibrary);
              eventDispatcher.dispatch('toast', {
                message: _('{{title}} added to library', { title: imported.title }),
                timeout: 3000,
                type: 'success',
              });
            }
          } catch (err) {
            console.error('[Sources] Import failed:', err);
            eventDispatcher.dispatch('toast', {
              message: _('Failed to import book'),
              timeout: 3000,
              type: 'error',
            });
          }
        },
      });
    } catch (error) {
      console.error('Download failed:', error);
    }
  }, [appService, libraryBooks, setLibrary, _]);

  // Handle open streaming
  const handleStream = useCallback(async (result: SourceSearchResult) => {
    if (!result.streamingUrl) return;
    
    try {
      // TODO: Open in reader
      window.open(result.streamingUrl, '_blank');
    } catch (error) {
      console.error('Streaming failed:', error);
    }
  }, []);

  // Clear search
  const handleClear = useCallback(() => {
    setSearchQuery('');
    setDoiQuery('');
    setIsbnQuery('');
    setSearchResults([]);
    setSearchProgress([]);
  }, []);

  const enabledSources = getEnabledSources();

  return (
    <div className='flex h-full flex-col bg-base-100'>
      {/* Header - Compact */}
      <div className='border-base-300 flex-shrink-0 border-b px-4 py-2'>
        <div className='flex items-center justify-between'>
          <h1 className='text-lg font-bold'>{_('Sources')}</h1>
          <div className='flex items-center gap-3'>
            {/* Settings toggles */}
            <label className='label cursor-pointer gap-2'>
              <input
                type='checkbox'
                checked={autoSearch}
                onChange={e => setAutoSearch(e.target.checked)}
                className='toggle toggle-xs toggle-primary'
              />
              <span className='text-xs'>{_('Auto-search')}</span>
            </label>
            <label className='label cursor-pointer gap-2'>
              <input
                type='checkbox'
                checked={preferOpenAccess}
                onChange={e => setPreferOpenAccess(e.target.checked)}
                className='toggle toggle-xs toggle-primary'
              />
              <span className='text-xs'>{_('Open Access')}</span>
            </label>
          </div>
        </div>
      </div>

      {/* Search Bar - Compact */}
      <div className='border-base-300 bg-base-100 flex-shrink-0 border-b px-4 py-3'>
        <div className='mx-auto max-w-6xl'>
          {/* Main search inputs */}
          <div className='flex gap-2'>
            {/* Query search */}
            <div className='relative flex-1'>
              <IoSearch className='text-base-content/50 absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2' />
              <input
                type='text'
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder={_('Search by title, author, or keywords...')}
                className='input h-9 w-full rounded-lg border-0 bg-base-200 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
                disabled={isSearching}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className='text-base-content/50 hover:text-base-content absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2'
                >
                  <IoClose />
                </button>
              )}
            </div>

            {/* DOI search */}
            <div className='relative w-40'>
              <IoDocumentText className='text-base-content/50 absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2' />
              <input
                type='text'
                value={doiQuery}
                onChange={e => setDoiQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleResolveDOI()}
                placeholder={_('DOI...')}
                className='input h-9 w-full rounded-lg border-0 bg-base-200 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
                disabled={isSearching}
              />
            </div>

            {/* ISBN search */}
            <div className='relative w-32'>
              <IoBook className='text-base-content/50 absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2' />
              <input
                type='text'
                value={isbnQuery}
                onChange={e => setIsbnQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                placeholder={_('ISBN...')}
                className='input h-9 w-full rounded-lg border-0 bg-base-200 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary'
                disabled={isSearching}
              />
            </div>

            {/* Search button */}
            {isSearching ? (
              <button
                onClick={handleCancel}
                className='btn btn-error h-9 min-h-9 px-4 text-sm'
              >
                <IoStop className='h-4 w-4' />
                {_('Stop')}
              </button>
            ) : (
              <button
                onClick={handleSearch}
                className='btn btn-primary h-9 min-h-9 px-4 text-sm'
              >
                <IoSearch className='h-4 w-4' />
                {_('Search')}
              </button>
            )}
          </div>

          {/* Options bar */}
          <div className='mt-2 flex items-center justify-between'>
            <div className='flex items-center gap-2'>
              {/* Filter toggle */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className='btn btn-ghost btn-xs gap-1'
              >
                <IoFilter className='h-3.5 w-3.5' />
                {_('Filters')}
                {showFilters ? (
                  <IoChevronUp className='h-3.5 w-3.5' />
                ) : (
                  <IoChevronDown className='h-3.5 w-3.5' />
                )}
              </button>

              {/* Source type quick filters */}
              <div className='flex gap-1'>
                {Object.values(SourceProviderType).map(type => (
                  <button
                    key={type}
                    onClick={() => {
                      if (selectedSourceTypes.includes(type)) {
                        setSelectedSourceTypes(selectedSourceTypes.filter(t => t !== type));
                      } else {
                        setSelectedSourceTypes([...selectedSourceTypes, type]);
                      }
                    }}
                    className={`badge badge-xs gap-1 ${
                      selectedSourceTypes.includes(type)
                        ? 'badge-primary'
                        : 'badge-outline'
                    }`}
                  >
                    <span className='capitalize'>{type.replace('_', ' ')}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* LibGen Filters - REMOVED from search bar */}
          {/* Will be shown in results area instead */}

          {/* Standard Filter panel - hide when showing LibGen filters */}
          {!(selectedSources.length === 1 && selectedSources.includes('libgen')) && showFilters && (
            <div className="mt-4">
              <SourceFilter
                sources={enabledSources}
                selectedSources={selectedSources}
                excludedSources={excludedSources}
                onSelectedSourcesChange={setSelectedSources}
                onExcludedSourcesChange={setExcludedSources}
              />
            </div>
          )}
        </div>
      </div>

      {/* Main content - scrollable results */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Results */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            <div className="mx-auto max-w-6xl">
            {/* Progress panel */}
            {isSearching && searchProgress.length > 0 && (
              <SearchProgressPanel progress={searchProgress} />
            )}

            {/* LibGen Filters (when LibGen is only source) - IN RESULTS AREA */}
            {selectedSources.length === 1 && selectedSources.includes('libgen') && (
              <LibGenFilters
                filters={libGenFilters}
                onFiltersChange={setLibGenFilters}
                currentTab={libGenTab}
                onTabChange={setLibGenTab}
                isSearching={isSearching || searchResults.length > 0}
                resultCounts={{
                  files: searchResults.length,
                  editions: 0,
                  series: 0,
                  authors: 0,
                  publishers: 0,
                  works: 0,
                }}
              />
            )}

            {/* Results count and pagination */}
            {!isSearching && searchResults.length > 0 && (
              <div className='mb-4 flex items-center justify-between'>
                <div className="flex items-center gap-4">
                  <p className='text-base-content/70 text-sm'>
                    {_('{{count}} results found', { count: searchResults.length })}
                  </p>
                  {selectedSources.length === 1 && selectedSources.includes('libgen') && (
                    <span className="text-xs text-base-content/50">
                      (showing {searchResults.length} results)
                    </span>
                  )}
                </div>
                <RateLimitStatus status={rateLimitStatus} />
              </div>
            )}

            {/* LibGen Table (when LibGen is only source) - with client-side pagination */}
            {selectedSources.length === 1 && selectedSources.includes('libgen') && searchResults.length > 0 ? (
              <>
                {/* Show only current page of results (25 per page) */}
                <LibGenResultTable
                  results={searchResults.slice(
                    (libGenCurrentPage - 1) * 25,
                    libGenCurrentPage * 25
                  )}
                  onDownload={handleDownload}
                  sortField={libGenSortField}
                  sortDirection={libGenSortDirection}
                  onSort={(field) => {
                    if (libGenSortField === field) {
                      setLibGenSortDirection(libGenSortDirection === 'asc' ? 'desc' : 'asc');
                    } else {
                      setLibGenSortField(field);
                      setLibGenSortDirection('desc');
                    }
                  }}
                />
                
                {/* Pagination controls */}
                <div className="mt-4 flex justify-center">
                  <div className="btn-group">
                    {Array.from({ length: libGenTotalPages }, (_, i) => i + 1).map((page) => (
                      <button
                        key={page}
                        className={`btn btn-xs ${libGenCurrentPage === page ? 'btn-active' : ''}`}
                        onClick={() => setLibGenCurrentPage(page)}
                      >
                        {page}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : searchResults.length > 0 ? (
              /* Standard card grid for other sources */
              <div className='grid gap-4 md:grid-cols-2 lg:grid-cols-3'>
                {searchResults.map((result, index) => (
                  <SearchResultCard
                    key={`${result.sourceId}-${result.id}-${index}`}
                    result={result}
                    onDownload={() => handleDownload(result)}
                    onStream={() => handleStream(result)}
                  />
                ))}
              </div>
            ) : !isSearching ? (
              <div className='flex h-96 flex-col items-center justify-center text-center'>
                <IoGlobe className='text-base-content/20 mb-4 h-24 w-24' />
                <h3 className='mb-2 text-lg font-semibold'>{_('No results yet')}</h3>
                <p className='text-base-content/70 max-w-md text-sm'>
                  {_('Search for books, articles, or papers using title, author, DOI, or ISBN')}
                </p>
              </div>
            ) : null}
            </div>
          </div>
        </div>
      </div>
      
      {/* Download queue panel */}
      <DownloadQueuePanel />
    </div>
  );
}
