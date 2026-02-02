import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { LibraryCoverFitType, LibraryViewModeType } from '@/types/settings';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary } from '@/utils/nav';
import NumberInput from '@/components/settings/NumberInput';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';

interface ViewMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const ViewMenu: React.FC<ViewMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();

  const viewMode = settings.libraryViewMode;
  const coverFit = settings.libraryCoverFit;
  const autoColumns = settings.libraryAutoColumns;
  const columns = settings.libraryColumns;

  const viewOptions = [
    { label: _('List'), value: 'list' },
    { label: _('Grid'), value: 'grid' },
  ];

  const coverFitOptions = [
    { label: _('Crop'), value: 'crop' },
    { label: _('Fit'), value: 'fit' },
  ];

  const handleSetViewMode = async (value: LibraryViewModeType) => {
    await saveSysSettings(envConfig, 'libraryViewMode', value);

    const params = new URLSearchParams(searchParams?.toString());
    params.set('view', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleToggleCropCovers = async (value: LibraryCoverFitType) => {
    await saveSysSettings(envConfig, 'libraryCoverFit', value);

    const params = new URLSearchParams(searchParams?.toString());
    params.set('cover', value);
    navigateToLibrary(router, `${params.toString()}`);
  };

  const handleToggleAutoColumns = async () => {
    const newValue = !settings.libraryAutoColumns;
    await saveSysSettings(envConfig, 'libraryAutoColumns', newValue);
  };

  const handleSetColumns = async (value: number) => {
    await saveSysSettings(envConfig, 'libraryColumns', value);
    await saveSysSettings(envConfig, 'libraryAutoColumns', false);
  };

  return (
    <Menu
      className='view-menu dropdown-content no-triangle z-20 mt-2 shadow-2xl'
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {viewOptions.map((option) => (
        <MenuItem
          key={option.value}
          label={option.label}
          buttonClass='h-8'
          toggled={viewMode === option.value}
          onClick={() => handleSetViewMode(option.value as LibraryViewModeType)}
          transient
        />
      ))}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Columns')} buttonClass='h-8' labelClass='text-sm sm:text-xs' disabled />
      <MenuItem
        label={_('Auto')}
        buttonClass='h-10'
        toggled={autoColumns}
        disabled={viewMode === 'list'}
        siblings={
          <NumberInput
            className='!h-10 !p-0 !pe-1 !ps-0'
            inputClassName={`!p-0 text-center text-base sm:text-sm !w-10 !h-6 !pe-0 ${autoColumns ? 'opacity-50' : ''}`}
            label={''}
            value={columns}
            disabled={viewMode === 'list'}
            onChange={handleSetColumns}
            min={window.innerWidth < 640 ? 1 : window.innerWidth < 1024 ? 2 : 3}
            max={window.innerWidth < 640 ? 4 : window.innerWidth < 1024 ? 6 : 12}
          />
        }
        onClick={() => handleToggleAutoColumns()}
      />
      <hr aria-hidden='true' className='border-base-200 my-1' />
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
          toggled={coverFit === option.value}
          onClick={() => handleToggleCropCovers(option.value as LibraryCoverFitType)}
          transient
        />
      ))}
    </Menu>
  );
};

export default ViewMenu;
