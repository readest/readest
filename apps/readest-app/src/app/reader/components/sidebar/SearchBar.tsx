import clsx from 'clsx';
import React, { useCallback, useEffect, useRef } from 'react';
import { FaSearch, FaChevronDown } from 'react-icons/fa';

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
    queuedSearchTerm.current = value;
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
              console.log('search done');
            }
          } else {
            if (result.progress) {
              const now = Date.now();
              if (now - lastProgressLogTime >= 1000) {
                console.log('search progress:', result.progress);
                lastProgressLogTime = now;
              }
              if (queuedSearchTerm.current && queuedSearchTerm.current !== term) {
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
    [progress, searchConfig, setSearchResults],
  );

  const resetSearch = useCallback(() => {
    setSearchResults(bookKey, []);
    view?.clearSearch();
  }, [bookKey, view, setSearchResults]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleSearchTermChange = useCallback(
    debounce((term: string) => {
      if (exceedMinSearchTermLength(term)) {
        handleSearch(term);
      } else {
        resetSearch();
      }
    }, 500),
    [handleSearch, resetSearch],
  );

  return (
    <div className='relative p-2'>
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
          className='w-full bg-transparent p-2 font-sans text-sm font-light focus:outline-none'
        />

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
    </div>
  );
};

export default SearchBar;
