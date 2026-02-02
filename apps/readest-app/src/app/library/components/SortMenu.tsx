import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { LibrarySortByType } from '@/types/settings';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary } from '@/utils/nav';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import Dropdown from '@/components/Dropdown';
import { PiSortAscending, PiSortDescending } from 'react-icons/pi';

interface SortMenuProps {
  className?: string;
  buttonClassName?: string;
}

const SortMenu: React.FC<SortMenuProps> = ({ className, buttonClassName }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();

  const sortBy = settings.librarySortBy;
  const isAscending = settings.librarySortAscending;

  const sortByOptions = [
    { label: _('Title'), value: LibrarySortByType.Title },
    { label: _('Author'), value: LibrarySortByType.Author },
    { label: _('Format'), value: LibrarySortByType.Format },
    { label: _('Date Read'), value: LibrarySortByType.Updated },
    { label: _('Date Added'), value: LibrarySortByType.Created },
    { label: _('Date Published'), value: LibrarySortByType.Published },
  ];

  const sortingOptions = [
    { label: _('Ascending'), value: true },
    { label: _('Descending'), value: false },
  ];

  const handleSetSortBy = async (value: LibrarySortByType) => {
    await saveSysSettings(envConfig, 'librarySortBy', value);

    const params = new URLSearchParams(searchParams?.toString());
    params.set('sort', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetSortAscending = async (value: boolean) => {
    await saveSysSettings(envConfig, 'librarySortAscending', value);

    const params = new URLSearchParams(searchParams?.toString());
    params.set('order', value ? 'asc' : 'desc');
    navigateToLibrary(router, `${params.toString()}`);
  };

  const currentSortLabel = sortByOptions.find((o) => o.value === sortBy)?.label || _('Title');

  return (
    <Dropdown
      label={_('Sort by...')}
      className={className}
      buttonClassName={buttonClassName}
      toggleButton={
        <div className='flex items-center space-x-1 px-2 text-sm font-medium'>
          <span className='text-base-content/50'>{_('Sort')}:</span>
          <span className='truncate'>{currentSortLabel}</span>
          {isAscending ? <PiSortAscending size={14} /> : <PiSortDescending size={14} />}
        </div>
      }
    >
      <Menu className='view-menu dropdown-content no-triangle z-20 mt-2 shadow-2xl'>
        <MenuItem
          label={_('Sort by...')}
          buttonClass='h-8'
          labelClass='text-sm sm:text-xs'
          disabled
        />
        {sortByOptions.map((option) => (
          <MenuItem
            key={option.value}
            label={option.label}
            buttonClass='h-8'
            toggled={sortBy === option.value}
            onClick={() => handleSetSortBy(option.value as LibrarySortByType)}
            transient
          />
        ))}
        <hr aria-hidden='true' className='border-base-200 my-1' />
        {sortingOptions.map((option) => (
          <MenuItem
            key={option.value.toString()}
            label={option.label}
            buttonClass='h-8'
            toggled={isAscending === option.value}
            onClick={() => handleSetSortAscending(option.value)}
            transient
          />
        ))}
      </Menu>
    </Dropdown>
  );
};

export default SortMenu;
