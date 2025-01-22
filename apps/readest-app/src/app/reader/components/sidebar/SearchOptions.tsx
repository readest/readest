import React from 'react';
import { MdCheck } from 'react-icons/md';
import { BookSearchConfig } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';

interface SearchOptionsProps {
  searchConfig: BookSearchConfig;
  onSearchConfigChanged: (searchConfig: BookSearchConfig) => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

interface OptionProps {
  label: string;
  isActive: boolean;
  onClick: () => void;
}

const Option: React.FC<OptionProps> = ({ label, isActive, onClick }) => (
  <button
    className='hover:bg-base-300 flex w-full items-center justify-between rounded-md p-2'
    onClick={onClick}
  >
    <div className='flex items-center'>
      <span style={{ minWidth: '20px' }}>
        {isActive && <MdCheck className='text-base-content' />}
      </span>
      <span className='ml-2'>{label}</span>
    </div>
  </button>
);

const SearchOptions: React.FC<SearchOptionsProps> = ({
  searchConfig,
  onSearchConfigChanged,
  setIsDropdownOpen,
}) => {
  const _ = useTranslation();
  const updateConfig = (key: keyof BookSearchConfig, value: boolean | string) => {
    onSearchConfigChanged({ ...searchConfig, [key]: value });
    setIsDropdownOpen?.(false);
  };

  return (
    <div
      tabIndex={0}
      className='book-menu dropdown-content dropdown-center border-base-200 z-20 mt-3 w-56 border shadow-2xl'
    >
      <Option
        label={_('Book')}
        isActive={searchConfig.scope === 'book'}
        onClick={() => updateConfig('scope', 'book')}
      />
      <Option
        label={_('Chapter')}
        isActive={searchConfig.scope === 'section'}
        onClick={() => updateConfig('scope', 'section')}
      />
      <hr className='border-base-200 my-1' />
      <Option
        label={_('Match Case')}
        isActive={searchConfig.matchCase}
        onClick={() => updateConfig('matchCase', !searchConfig.matchCase)}
      />
      <Option
        label={_('Match Whole Words')}
        isActive={searchConfig.matchWholeWords}
        onClick={() => updateConfig('matchWholeWords', !searchConfig.matchWholeWords)}
      />
      <Option
        label={_('Match Diacritics')}
        isActive={searchConfig.matchDiacritics}
        onClick={() => updateConfig('matchDiacritics', !searchConfig.matchDiacritics)}
      />
    </div>
  );
};

export default SearchOptions;
