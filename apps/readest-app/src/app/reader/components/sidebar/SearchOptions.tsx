import clsx from 'clsx';
import React from 'react';
import { MdCheck } from 'react-icons/md';
import { BookSearchConfig } from '@/types/book';
import { useTranslation } from '@/hooks/useTranslation';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';

interface SearchOptionsProps {
  isEink: boolean;
  searchConfig: BookSearchConfig;
  menuClassName?: string;
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
    className={clsx(
      'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors duration-150',
      isActive
        ? 'bg-[#311814]/92 text-[#f0d6a0]'
        : 'text-[#d8c39b] hover:bg-[#241612] hover:text-[#f0d6a0]',
    )}
    onClick={onClick}
  >
    <div className='flex items-center'>
      <span style={{ minWidth: `${useDefaultIconSize()}px` }}>
        {isActive && <MdCheck className='text-[#d6b06b]' />}
      </span>
      <span className='ml-2'>{label}</span>
    </div>
  </button>
);

const SearchOptions: React.FC<SearchOptionsProps> = ({
  isEink,
  searchConfig,
  menuClassName,
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
      className={clsx(
        'search-options dropdown-content border-[#c9a45a]/28 z-20 w-56 rounded-xl border bg-[linear-gradient(180deg,rgba(18,12,10,0.98),rgba(11,8,7,0.98))] p-1.5 shadow-[0_18px_40px_rgba(0,0,0,0.34),0_0_18px_rgba(126,31,25,0.16)]',
        isEink ? 'bordercolor-content border-base-content !bg-base-100 border' : '',
        menuClassName,
      )}
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
      <hr aria-hidden='true' className='border-[#5e4525]/24 my-1' />
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
