import clsx from 'clsx';
import React, { useEffect, useRef, useState } from 'react';
import { FaSearch, FaChevronDown } from 'react-icons/fa';

import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useBookDataStore } from '@/store/bookDataStore';
import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { BookSearchConfig, BookSearchResult } from '@/types/book';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import Dropdown from '@/components/Dropdown';
import SearchOptions from './SearchOptions';

const MINIMUM_SEARCH_TERM_LENGTH_DEFAULT = 2;
const MINIMUM_SEARCH_TERM_LENGTH_CJK = 1;

interface SearchBarProps {
  isVisible: boolean;
  bookKey: string;
  searchTerm: string;
  onSearchResultChange: (results: BookSearchResult[]) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({
  isVisible,
  bookKey,
  searchTerm: term,
  onSearchResultChange,
}) => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();
  const { getConfig, saveConfig } = useBookDataStore();
  const { getView, getProgress } = useReaderStore();
  const [searchTerm, setSearchTerm] = useState(term);
  const inputRef = useRef<HTMLInputElement>(null);

  const view = getView(bookKey)!;
  const config = getConfig(bookKey)!;
  const progress = getProgress(bookKey)!;
  const searchConfig = config.searchConfig! as BookSearchConfig;

  const queuedSearchTerm = useRef('');
  const isSearchPending = useRef(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const iconSize12 = useResponsiveSize(12);
  const iconSize16 = useResponsiveSize(16);

  useEffect(() => {
    handleSearchTermChange(searchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookKey]);

  useEffect(() => {
    setSearchTerm(term);
    handleSearchTermChange(term);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    if (isVisible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isVisible]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && inputRef.current) {
        inputRef.current.blur();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (searchTimeout.current) {
        clearTimeout(searchTimeout.current);
      }
    };
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchTerm(value);

    if (searchTimeout.current) {
      clearTimeout(searchTimeout.current);
    }

    searchTimeout.current = setTimeout(() => {
      if (!isSearchPending.current) {
        handleSearchTermChange(value);
      } else {
        queuedSearchTerm.current = value;
      }
    }, 500);
  };

  const handleSearchConfigChange = (searchConfig: BookSearchConfig) => {
    config.searchConfig = searchConfig;
    saveConfig(envConfig, bookKey, config, settings);
    handleSearchTermChange(searchTerm);
  };

  const exceedMinSearchTermLength = (searchTerm: string) => {
    const isCJK = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(searchTerm);
    const minLength = isCJK ? MINIMUM_SEARCH_TERM_LENGTH_CJK : MINIMUM_SEARCH_TERM_LENGTH_DEFAULT;

    return searchTerm.length >= minLength;
  };

  const handleSearchTermChange = (term: string) => {
    if (exceedMinSearchTermLength(term)) {
      handleSearch(term);
    } else {
      resetSearch();
    }
  };

  const handleSearch = async (term: string) => {
    console.log('searching for:', term);
    isSearchPending.current = true;
    const { section } = progress;
    const index = searchConfig.scope === 'section' ? section.current : undefined;
    const generator = await view.search({ ...searchConfig, query: term, index });
    const results: BookSearchResult[] = [];
    for await (const result of generator) {
      if (typeof result === 'string') {
        if (result === 'done') {
          onSearchResultChange([...results]);
          isSearchPending.current = false;
          console.log('search done');
          if (
            queuedSearchTerm.current !== term &&
            exceedMinSearchTermLength(queuedSearchTerm.current)
          ) {
            handleSearch(queuedSearchTerm.current);
          }
        }
      } else {
        if (result.progress) {
          //console.log('search progress:', result.progress);
        } else {
          results.push(result);
          onSearchResultChange([...results]);
        }
      }
    }
  };

  const resetSearch = () => {
    onSearchResultChange([]);
    view?.clearSearch();
  };

  return (
    <div className='relative p-2'>
      <div className='bg-base-100 flex h-8 items-center rounded-lg'>
        <div className='pl-3'>
          <FaSearch size={iconSize16} className='text-gray-500' />
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
            className={clsx(
              window.innerWidth < 640 && 'dropdown-end',
              'dropdown-bottom flex justify-center',
            )}
            menuClassName={window.innerWidth < 640 ? 'no-triangle mt-1' : 'dropdown-center mt-3'}
            buttonClassName='btn btn-ghost h-8 min-h-8 w-8 p-0 rounded-none rounded-r-lg'
            toggleButton={<FaChevronDown size={iconSize12} className='text-gray-500' />}
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
