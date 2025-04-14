import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MdCheck } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { LibrarySortByType } from '@/types/settings';
import { navigateToLibrary } from '@/utils/nav';
import MenuItem from '@/components/MenuItem';

interface SortMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const SortMenu: React.FC<SortMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const sortBy = settings.librarySortBy;
  const isAscending = settings.librarySortAscending;

  const sortByOptions = [
    { label: _('Title'), value: 'title' },
    { label: _('Author'), value: 'author' },
    { label: _('Format'), value: 'format' },
    { label: _('Date Read'), value: 'updated' },
    { label: _('Date Added'), value: 'created' },
  ];

  const sortingOptions = [
    { label: _('Ascending'), value: true },
    { label: _('Descending'), value: false },
  ];

  const handleSetSortBy = (value: LibrarySortByType) => {
    settings.librarySortBy = value;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsDropdownOpen?.(false);

    const params = new URLSearchParams(searchParams?.toString());
    params.set('sort', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleSetSortAscending = (value: boolean) => {
    settings.librarySortAscending = value;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsDropdownOpen?.(false);

    const params = new URLSearchParams(searchParams?.toString());
    params.set('order', value ? 'asc' : 'desc');
    navigateToLibrary(router, `${params.toString()}`);
  };

  return (
    <div
      tabIndex={0}
      className='settings-menu dropdown-content no-triangle border-base-100 z-20 mt-2 shadow-2xl'
    >
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
          icon={sortBy === option.value ? <MdCheck className='text-base-content' /> : undefined}
          onClick={() => handleSetSortBy(option.value as LibrarySortByType)}
        />
      ))}
      <hr className='border-base-200 my-1' />
      {sortingOptions.map((option) => (
        <MenuItem
          key={option.value.toString()}
          label={option.label}
          buttonClass='h-8'
          icon={
            isAscending === option.value ? <MdCheck className='text-base-content' /> : undefined
          }
          onClick={() => handleSetSortAscending(option.value)}
        />
      ))}
    </div>
  );
};

export default SortMenu;
