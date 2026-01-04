import clsx from 'clsx';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaSearch, FaChevronDown } from 'react-icons/fa';
import { IoMdCloseCircle } from 'react-icons/io';
import { MdDeleteOutline } from 'react-icons/md';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useSidebarStore } from '@/store/sidebarStore';
import { useTranslation } from '@/hooks/useTranslation';
import { BookSearchConfig, BookSearchResult } from '@/types/book';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { debounce } from '@/utils/debounce';
import { isCJKStr } from '@/utils/lang';
import { createRejectFilter } from '@/utils/node';
import Dropdown from '@/components/Dropdown';
import SearchOptions from './SearchOptions';

const MINIMUM_SEARCH_TERM_LENGTH_DEFAULT = 2;
const MINIMUM_SEARCH_TERM_LENGTH_CJK = 1;
const SEARCH_HISTORY_KEY = 'search-history';
const MAX_SEARCH_HISTORY = 10;

interface SearchBarProps {
  isVisible: boolean;
  bookKey: string;
  onHideSearchBar: () => void;
}

const SearchBar: React.FC<SearchBarProps> = ({ isVisible, bookKey, onHideSearchBar }) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getBookData } = useBookDataStore();
  const { getConfig, saveConfig } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const { getSearchNavState, setSearchTerm, setSearchResults } = useSidebarStore();
  const searchNavState = getSearchNavState(bookKey);

  const { searchTerm } = searchNavState;
  const queuedSearchTerm = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputFocusedRef = useRef(false);

  const bookHash = useMemo(() => bookKey.split('-')[0]!, [bookKey]);
  const historyStorageKey = useMemo(() => `${SEARCH_HISTORY_KEY}-${bookHash}`, [bookHash]);

  const [searchHistory, setSearchHistory] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(historyStorageKey);
      return saved ? JSON.parse(saved) : [];
    }
    return [];
  });

  useEffect(() => {
    const saved = localStorage.getItem(historyStorageKey);
    setSearchHistory(saved ? JSON.parse(saved) : []);
  }, [historyStorageKey]);

  const addToHistory = useCallback(
    (term: string) => {
      setSearchHistory((prev) => {
        const filtered = prev.filter((t) => t !== term);
        const updated = [term, ...filtered].slice(0, MAX_SEARCH_HISTORY);
        localStorage.setItem(historyStorageKey, JSON.stringify(updated));
        return updated;
      });
    },
    [historyStorageKey],
  );

  const handleHistoryClick = (term: string) => {
    setSearchTerm(bookKey, term);
    handleSearchTermChange(term);
  };

  const handleClearInput = () => {
    setSearchTerm(bookKey, '');
    resetSearch();
    inputRef.current?.focus();
  };

  const handleClearHistory = () => {
    setSearchHistory([]);
    localStorage.removeItem(historyStorageKey);
  };

  const view = getView(bookKey)!;
  const config = getConfig(bookKey)!;
  const bookData = getBookData(bookKey)!;
  const progress = getProgress(bookKey)!;
  const primaryLang = bookData.book?.primaryLanguage || 'en';
  const searchConfig = config.searchConfig! as BookSearchConfig;

  const iconSize12 = useResponsiveSize(12);
  const iconSize16 = useResponsiveSize(16);

  useEffect(() => {
    handleSearchTermChange(searchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey, searchTerm]);

  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.onblur = () => {
        inputFocusedRef.current = false;
      };
      inputRef.current.onfocus = () => {
        inputFocusedRef.current = true;
      };
      inputRef.current.focus();
    }
    if (isVisible && searchTerm) {
      handleSearchTermChange(searchTerm);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (inputRef.current && inputFocusedRef.current) {
          inputRef.current.blur();
        } else {
          onHideSearchBar();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onHideSearchBar]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(bookKey, value);
    handleSearchTermChange(value);
  };

  const handleSearchConfigChange = (searchConfig: BookSearchConfig) => {
    config.searchConfig = searchConfig;
    saveConfig(envConfig, bookKey, config, settings);
    handleSearchTermChange(searchTerm);
  };

  const exceedMinSearchTermLength = (searchTerm: string) => {
    const minLength = isCJKStr(searchTerm)
      ? MINIMUM_SEARCH_TERM_LENGTH_CJK
      : MINIMUM_SEARCH_TERM_LENGTH_DEFAULT;

    return searchTerm.length >= minLength;
  };

  const handleSearch = useCallback(
    async (term: string) => {
      console.log('searching for:', term);
      const { section } = progress;
      const index = searchConfig.scope === 'section' ? section.current : undefined;
      const generator = await view.search({
        ...searchConfig,
        index,
        query: term,
        acceptNode: createRejectFilter({
          tags: primaryLang.startsWith('ja') ? ['rt'] : [],
        }),
      });
      const results: BookSearchResult[] = [];
      let lastProgressLogTime = 0;

      const processResults = async () => {
        for await (const result of generator) {
          if (typeof result === 'string') {
            if (result === 'done') {
              setSearchResults(bookKey, [...results]);
              if (results.length > 0) {
                addToHistory(term);
              }
              console.log('search done');
            }
          } else {
            if (result.progress) {
              const now = Date.now();
              if (now - lastProgressLogTime >= 1000) {
                console.log('search progress:', result.progress);
                lastProgressLogTime = now;
              }
              if (queuedSearchTerm.current !== term) {
                console.log('search term changed, resetting search');
                resetSearch();
                return;
              }
            } else {
              results.push(result);
              setSearchResults(bookKey, [...results]);
            }
          }

          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      };

      processResults();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progress, searchConfig, setSearchResults, addToHistory],
  );

  const resetSearch = useCallback(() => {
    setSearchResults(bookKey, []);
    view?.clearSearch();
  }, [bookKey, view, setSearchResults]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSearchTermChange = useCallback(
    debounce((term: string) => {
      queuedSearchTerm.current = term;
      if (exceedMinSearchTermLength(term)) {
        handleSearch(term);
      } else {
        resetSearch();
      }
    }, 500),
    [handleSearch, resetSearch],
  );

  return (
    <div className='relative flex flex-col gap-3 p-2'>
      <div className='bg-base-100 flex h-8 items-center rounded-lg'>
        <div className='pl-3'>
          <FaSearch size={iconSize16} className='text-base-content/50' />
        </div>

        <input
          ref={inputRef}
          type='text'
          value={searchTerm}
          spellCheck={false}
          onChange={handleInputChange}
          placeholder={_('Search...')}
          className='w-full bg-transparent p-2 pr-0 font-sans text-sm font-light focus:outline-none'
        />

        {searchTerm && (
          <button
            onClick={handleClearInput}
            className='flex h-8 w-8 items-center justify-center bg-transparent pe-2'
            aria-label={_('Clear search')}
          >
            <IoMdCloseCircle size={iconSize16} className='text-base-content/75' />
          </button>
        )}

        <div className='bg-base-300 flex h-8 w-8 items-center rounded-r-lg'>
          <Dropdown
            label={_('Search Options')}
            className={clsx(
              window.innerWidth < 640 && 'dropdown-end',
              'dropdown-bottom flex justify-center',
            )}
            menuClassName={window.innerWidth < 640 ? 'no-triangle mt-1' : 'dropdown-center mt-3'}
            buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0 rounded-none rounded-r-lg'
            toggleButton={<FaChevronDown size={iconSize12} className='text-base-content/50' />}
          >
            <SearchOptions
              searchConfig={searchConfig}
              onSearchConfigChanged={handleSearchConfigChange}
            />
          </Dropdown>
        </div>
      </div>

      {searchHistory.length > 0 && !searchTerm && (
        <div className='relative flex'>
          <div
            className='from-base-200 pointer-events-none absolute left-0 top-0 h-full w-3 bg-gradient-to-r to-transparent'
            aria-hidden='true'
          />
          <div
            className='scrollbar-hidden flex flex-1 gap-1.5 overflow-x-auto'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {searchHistory.map((term, index) => (
              <button
                key={index}
                onClick={() => handleHistoryClick(term)}
                className='hover:bg-base-content/20 text-base-content/70 bg-base-100 flex-shrink-0 whitespace-nowrap rounded-full px-3 py-0.5 text-xs'
              >
                {term}
              </button>
            ))}
          </div>
          <div
            className='from-base-200 pointer-events-none absolute right-6 top-0 h-full w-6 bg-gradient-to-l to-transparent'
            aria-hidden='true'
          />
          <button
            onClick={handleClearHistory}
            className={clsx(
              'text-base-content/50 hover:text-base-content/80 bg-base-200 flex-shrink-0 items-center',
              'flex h-6 min-h-6 w-8 min-w-8 items-center justify-center p-0',
            )}
            title={_('Clear history')}
            aria-label={_('Clear history')}
          >
            <MdDeleteOutline size={iconSize16} />
          </button>
        </div>
      )}
    </div>
  );
};

export default SearchBar;
