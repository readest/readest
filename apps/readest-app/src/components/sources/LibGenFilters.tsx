'use client';

import React from 'react';

/**
 * LibGen Filter UI - Compact version matching libgen.li layout
 */

export interface LibGenFilterState {
  searchTitle: boolean;
  searchAuthor: boolean;
  searchSeries: boolean;
  searchYear: boolean;
  searchPublisher: boolean;
  searchISBN: boolean;
  searchFiles: boolean;
  searchEditions: boolean;
  searchSeriesObj: boolean;
  searchAuthors: boolean;
  searchPublishers: boolean;
  searchWorks: boolean;
  topicLibgen: boolean;
  topicComics: boolean;
  topicFiction: boolean;
  topicScientificArticles: boolean;
  topicMagazines: boolean;
  topicFictionRUS: boolean;
  topicStandards: boolean;
  resultsPerPage: 25 | 50 | 100;
  showCovers: boolean;
  showChapters: boolean;
  googleMode: boolean;
  filesUns: 'all' | 'sorted' | 'unsorted';
  language: string;
  extensions: {
    pdf: boolean;
    epub: boolean;
    fb2: boolean;
    cbz: boolean;
    djvu: boolean;
    mobi: boolean;
  };
}

export interface LibGenFiltersProps {
  filters: LibGenFilterState;
  onFiltersChange: (filters: LibGenFilterState) => void;
  resultCounts?: {
    files: number;
    editions: number;
    series: number;
    authors: number;
    publishers: number;
    works: number;
  };
  currentTab: string;
  onTabChange: (tab: string) => void;
  isSearching?: boolean;
}

const LibGenFilters: React.FC<LibGenFiltersProps> = ({
  filters,
  onFiltersChange,
  resultCounts,
  currentTab = 'files',
  onTabChange,
  isSearching = false,
}) => {
  const updateFilter = (key: keyof LibGenFilterState, value: any) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  const updateExtension = (ext: string, checked: boolean) => {
    updateFilter('extensions', { ...filters.extensions, [ext]: checked });
  };

  // Always show filters - they scroll with results
  // Only show result tabs when there are results
  return (
    <div className="libgen-filters mb-3">
      {/* Ultra-compact filter row */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        {/* Search in fields */}
        <div className="flex flex-wrap items-center gap-1.5">
          <strong className="text-xs whitespace-nowrap">Fields:</strong>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.searchTitle}
              onChange={(e) => updateFilter('searchTitle', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">Title</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.searchAuthor}
              onChange={(e) => updateFilter('searchAuthor', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">Author</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.searchSeries}
              onChange={(e) => updateFilter('searchSeries', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">Series</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.searchYear}
              onChange={(e) => updateFilter('searchYear', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">Year</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.searchPublisher}
              onChange={(e) => updateFilter('searchPublisher', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">Publisher</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.searchISBN}
              onChange={(e) => updateFilter('searchISBN', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">ISBN</span>
          </label>
        </div>

        {/* Search in topics */}
        <div className="flex flex-wrap items-center gap-1.5">
          <strong className="text-xs whitespace-nowrap">Topics:</strong>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.topicLibgen}
              onChange={(e) => updateFilter('topicLibgen', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">Libgen</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.topicFiction}
              onChange={(e) => updateFilter('topicFiction', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">Fiction</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.topicComics}
              onChange={(e) => updateFilter('topicComics', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">Comics</span>
          </label>
        </div>

        {/* Results per page */}
        <div className="flex items-center gap-1.5">
          <strong className="text-xs whitespace-nowrap">Show:</strong>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="resPerPage"
              value="25"
              checked={filters.resultsPerPage === 25}
              onChange={() => updateFilter('resultsPerPage', 25)}
              className="radio radio-xs radio-primary"
            />
            <span className="text-xs">25</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="resPerPage"
              value="50"
              checked={filters.resultsPerPage === 50}
              onChange={() => updateFilter('resultsPerPage', 50)}
              className="radio radio-xs radio-primary"
            />
            <span className="text-xs">50</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="radio"
              name="resPerPage"
              value="100"
              checked={filters.resultsPerPage === 100}
              onChange={() => updateFilter('resultsPerPage', 100)}
              className="radio radio-xs radio-primary"
            />
            <span className="text-xs">100</span>
          </label>
        </div>

        {/* Language */}
        <select
          className="select select-xs select-bordered h-7"
          value={filters.language}
          onChange={(e) => updateFilter('language', e.target.value)}
        >
          <option value="">All Languages</option>
          <option value="en">English</option>
          <option value="ru">Russian</option>
          <option value="fr">French</option>
          <option value="de">German</option>
        </select>

        {/* Extension filter - compact */}
        <div className="flex items-center gap-1">
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.extensions.pdf}
              onChange={(e) => updateExtension('pdf', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">PDF</span>
          </label>
          <label className="inline-flex items-center gap-1 cursor-pointer">
            <input
              type="checkbox"
              checked={filters.extensions.epub}
              onChange={(e) => updateExtension('epub', e.target.checked)}
              className="checkbox checkbox-xs checkbox-primary"
            />
            <span className="text-xs">EPUB</span>
          </label>
        </div>
      </div>

      {/* Result tabs - only show when there are results */}
      {resultCounts && resultCounts.files > 0 && (
        <ul className="nav nav-tabs mt-2 border-t border-base-300">
          <li className="nav-item inline-block mr-2">
            <button
              className={`btn btn-xs btn-ghost ${currentTab === 'files' ? 'btn-active' : ''}`}
              onClick={() => onTabChange('files')}
            >
              Files <span className="badge badge-xs badge-primary">{resultCounts.files}</span>
            </button>
          </li>
          <li className="nav-item inline-block mr-2">
            <button
              className={`btn btn-xs btn-ghost ${currentTab === 'editions' ? 'btn-active' : ''}`}
              onClick={() => onTabChange('editions')}
            >
              Editions <span className="badge badge-xs badge-primary">{resultCounts.editions}</span>
            </button>
          </li>
          <li className="nav-item inline-block mr-2">
            <button
              className={`btn btn-xs btn-ghost ${currentTab === 'series' ? 'btn-active' : ''}`}
              onClick={() => onTabChange('series')}
            >
              Series <span className="badge badge-xs badge-primary">{resultCounts.series}</span>
            </button>
          </li>
          <li className="nav-item inline-block mr-2">
            <button
              className={`btn btn-xs btn-ghost ${currentTab === 'authors' ? 'btn-active' : ''}`}
              onClick={() => onTabChange('authors')}
            >
              Authors <span className="badge badge-xs badge-primary">{resultCounts.authors}</span>
            </button>
          </li>
          <li className="nav-item inline-block mr-2">
            <button
              className={`btn btn-xs btn-ghost ${currentTab === 'publishers' ? 'btn-active' : ''}`}
              onClick={() => onTabChange('publishers')}
            >
              Publishers <span className="badge badge-xs badge-primary">{resultCounts.publishers}</span>
            </button>
          </li>
          <li className="nav-item inline-block mr-2">
            <button
              className={`btn btn-xs btn-ghost ${currentTab === 'works' ? 'btn-active' : ''}`}
              onClick={() => onTabChange('works')}
            >
              Works <span className="badge badge-xs badge-primary">{resultCounts.works}</span>
            </button>
          </li>
          <li className="nav-item inline-block" style={{ float: 'right' }}>
            <button
              className={`btn btn-xs btn-ghost ${currentTab === 'json' ? 'btn-active' : ''}`}
              onClick={() => onTabChange('json')}
            >
              JSON
            </button>
          </li>
        </ul>
      )}
    </div>
  );
};

export default LibGenFilters;
