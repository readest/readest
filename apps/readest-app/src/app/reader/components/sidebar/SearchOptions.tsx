import React from 'react';
import { MdCheck } from 'react-icons/md';
import { BookSearchConfig } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';

interface SearchOptionsProps {
  searchConfig: BookSearchConfig;
  onSearchConfigChanged: (searchConfig: BookSearchConfig) => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const SearchOptions: React.FC<SearchOptionsProps> = ({
  searchConfig,
  onSearchConfigChanged,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const handleSetScope = () => {
    onSearchConfigChanged({
      ...searchConfig,
      scope: searchConfig.scope === 'book' ? 'section' : 'book',
    });
    setIsDropdownOpen?.(false);
  };
  const handleSetMatchCase = () => {
    onSearchConfigChanged({ ...searchConfig, matchCase: !searchConfig.matchCase });
    setIsDropdownOpen?.(false);
  };
  const handleSetMatchWholeWords = () => {
    onSearchConfigChanged({ ...searchConfig, matchWholeWords: !searchConfig.matchWholeWords });
    setIsDropdownOpen?.(false);
  };
  const handleSetMatchDiacritics = () => {
    onSearchConfigChanged({ ...searchConfig, matchDiacritics: !searchConfig.matchDiacritics });
    setIsDropdownOpen?.(false);
  };

  return (
    <div
      tabIndex={0}
      className='book-menu dropdown-content dropdown-center z-20 mt-3 w-56 border bg-white shadow-2xl'
    >
      <button
        className='flex w-full items-center justify-between rounded-md p-2 hover:bg-gray-100'
        onClick={handleSetScope}
      >
        <div className='flex items-center'>
          <span style={{ minWidth: '20px' }}>
            {searchConfig.scope === 'book' && <MdCheck size={20} className='text-base-content' />}
          </span>
          <span className='ml-2'>{_('Book')}</span>
        </div>
      </button>

      <button
        className='flex w-full items-center justify-between rounded-md p-2 hover:bg-gray-100'
        onClick={handleSetScope}
      >
        <div className='flex items-center'>
          <span style={{ minWidth: '20px' }}>
            {searchConfig.scope === 'section' && (
              <MdCheck size={20} className='text-base-content' />
            )}
          </span>
          <span className='ml-2'>{_('Chapter')}</span>
        </div>
      </button>

      <hr className='my-1' />

      <button
        className='flex w-full items-center justify-between rounded-md p-2 hover:bg-gray-100'
        onClick={handleSetMatchCase}
      >
        <div className='flex items-center'>
          <span style={{ minWidth: '20px' }}>
            {searchConfig.matchCase && <MdCheck size={20} className='text-base-content' />}
          </span>
          <span className='ml-2'>{_('Match Case')}</span>
        </div>
      </button>

      <button
        className='flex w-full items-center justify-between rounded-md p-2 hover:bg-gray-100'
        onClick={handleSetMatchWholeWords}
      >
        <div className='flex items-center'>
          <span style={{ minWidth: '20px' }}>
            {searchConfig.matchWholeWords && <MdCheck size={20} className='text-base-content' />}
          </span>
          <span className='ml-2'>{_('Match Whole Words')}</span>
        </div>
      </button>

      <button
        className='flex w-full items-center justify-between rounded-md p-2 hover:bg-gray-100'
        onClick={handleSetMatchDiacritics}
      >
        <div className='flex items-center'>
          <span style={{ minWidth: '20px' }}>
            {searchConfig.matchDiacritics && <MdCheck size={20} className='text-base-content' />}
          </span>
          <span className='ml-2'>{_('Match Diacritics')}</span>
        </div>
      </button>
    </div>
  );
};

export default SearchOptions;
