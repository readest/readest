import React from 'react';
import { FiSearch } from 'react-icons/fi';

import { useReaderStore } from '@/store/readerStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useCommandPalette } from '@/components/command-palette';
import { getCommandPaletteShortcut } from '@/services/environment';

interface SearchTogglerProps {
  bookKey: string;
}

const SearchToggler: React.FC<SearchTogglerProps> = ({ bookKey: _bookKey }) => {
  const _ = useTranslation();
  const { setHoveredBookKey } = useReaderStore();
  const { open: openCommandPalette } = useCommandPalette();

  const handleOpenSearch = () => {
    setHoveredBookKey('');
    openCommandPalette();
  };

  return (
    <button
      onClick={handleOpenSearch}
      aria-label={_('Search Settings')}
      title={`${_('Search Settings')} (${getCommandPaletteShortcut()})`}
      className='btn btn-ghost btn-sm border-base-content/20 text-base-content/60 hover:border-base-content/30 hover:bg-base-200/50 hidden h-8 min-h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-normal sm:flex'
    >
      <FiSearch className='h-3.5 w-3.5' />
      <span className='hidden lg:inline'>{_('Search')}</span>
      <kbd className='kbd kbd-xs bg-base-200/80 ml-0.5 hidden text-[10px] lg:inline'>
        {getCommandPaletteShortcut()}
      </kbd>
    </button>
  );
};

export default SearchToggler;
