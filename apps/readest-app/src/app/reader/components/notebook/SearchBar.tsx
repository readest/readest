import React, { useEffect, useRef, useState } from 'react';
import { FaSearch, FaTimes } from 'react-icons/fa';

import { useBookDataStore } from '@/store/bookDataStore';
import { useTranslation } from '@/hooks/useTranslation';
import { BookNote } from '@/types/book';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';

interface SearchBarProps {
  isVisible: boolean;
  bookKey: string;
  searchTerm: string;
  onSearchResultChange: (results: BookNote[] | null) => void;
}

const SearchBar: React.FC<SearchBarProps> = ({
  isVisible,
  bookKey,
  searchTerm: term,
  onSearchResultChange,
}) => {
  const _ = useTranslation();
  const { getConfig } = useBookDataStore();
  const [searchTerm, setSearchTerm] = useState(term);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const iconSize16 = useResponsiveSize(16);
  const iconSize12 = useResponsiveSize(12);

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
      handleSearchTermChange(value);
    }, 300);
  };

  const handleClearSearch = () => {
    setSearchTerm('');
    handleSearchTermChange('');
    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const filterNotes = (notes: BookNote[], query: string): BookNote[] => {
    if (!query.trim()) return [];

    const lowercaseQuery = query.toLowerCase();
    return notes.filter((note) => {
      const textMatch = note.text?.toLowerCase().includes(lowercaseQuery) || false;
      const noteMatch = note.note?.toLowerCase().includes(lowercaseQuery) || false;
      return textMatch || noteMatch;
    });
  };

  const handleSearchTermChange = (term: string) => {
    if (term.trim().length >= 1) {
      handleSearch(term);
    } else {
      resetSearch();
    }
  };

  const handleSearch = (term: string) => {
    const config = getConfig(bookKey);
    if (!config) {
      resetSearch();
      return;
    }

    const { booknotes: allNotes = [] } = config;
    const validNotes = allNotes.filter((note) => !note.deletedAt);

    const results = filterNotes(validNotes, term);
    onSearchResultChange(results);
  };

  const resetSearch = () => {
    onSearchResultChange(null);
  };

  return (
    <div className='relative px-3 py-2'>
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
          placeholder={_('Search notes and excerpts...')}
          className='w-full bg-transparent p-2 font-sans text-sm font-light focus:outline-none'
        />

        {searchTerm && (
          <div className='bg-base-300 flex h-8 w-8 items-center rounded-r-lg'>
            <button
              onClick={handleClearSearch}
              className='btn btn-ghost h-8 min-h-8 w-8 rounded-none rounded-r-lg p-0'
            >
              <FaTimes size={iconSize12} className='text-base-content/50' />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default SearchBar;
