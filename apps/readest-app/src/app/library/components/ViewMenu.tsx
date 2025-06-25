import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MdCheck } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { LibraryCoverFitType, LibrarySortByType, LibraryViewModeType } from '@/types/settings';
import { navigateToLibrary } from '@/utils/nav';
import MenuItem from '@/components/MenuItem';

interface ViewMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const ViewMenu: React.FC<ViewMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const viewMode = settings.libraryViewMode;
  const sortBy = settings.librarySortBy;
  const isAscending = settings.librarySortAscending;
  const coverFit = settings.libraryCoverFit;

  const viewOptions = [
    { label: _('List'), value: 'list' },
    { label: _('Grid'), value: 'grid' },
  ];

  const coverFitOptions = [
    { label: _('Crop'), value: 'crop' },
    { label: _('Fit'), value: 'fit' },
  ];

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

  const handleSetViewMode = (value: LibraryViewModeType) => {
    settings.libraryViewMode = value;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsDropdownOpen?.(false);

    const params = new URLSearchParams(searchParams?.toString());
    params.set('view', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleToggleCropCovers = (value: LibraryCoverFitType) => {
    settings.libraryCoverFit = value;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsDropdownOpen?.(false);

    const params = new URLSearchParams(searchParams?.toString());
    params.set('cover', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

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
      {viewOptions.map((option) => (
        <MenuItem
          key={option.value}
          label={option.label}
          buttonClass='h-8'
          Icon={viewMode === option.value ? MdCheck : undefined}
          onClick={() => handleSetViewMode(option.value as LibraryViewModeType)}
        />
      ))}
      <hr className='border-base-200 my-1' />
      <MenuItem
        label={_('Book Covers')}
        buttonClass='h-8'
        labelClass='text-sm sm:text-xs'
        disabled
      />
      {coverFitOptions.map((option) => (
        <MenuItem
          key={option.value}
          label={option.label}
          buttonClass='h-8'
          Icon={coverFit === option.value ? MdCheck : undefined}
          onClick={() => handleToggleCropCovers(option.value as LibraryCoverFitType)}
        />
      ))}
      <hr className='border-base-200 my-1' />
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
          Icon={sortBy === option.value ? MdCheck : undefined}
          onClick={() => handleSetSortBy(option.value as LibrarySortByType)}
        />
      ))}
      <hr className='border-base-200 my-1' />
      {sortingOptions.map((option) => (
        <MenuItem
          key={option.value.toString()}
          label={option.label}
          buttonClass='h-8'
          Icon={isAscending === option.value ? MdCheck : undefined}
          onClick={() => handleSetSortAscending(option.value)}
        />
      ))}
    </div>
  );
};

export default ViewMenu;
