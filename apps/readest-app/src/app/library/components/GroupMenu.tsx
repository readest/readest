import React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { LibraryGroupByType } from '@/types/settings';
import { saveSysSettings } from '@/helpers/settings';
import { navigateToLibrary } from '@/utils/nav';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import Dropdown from '@/components/Dropdown';

interface GroupMenuProps {
  className?: string;
  buttonClassName?: string;
}

const GroupMenu: React.FC<GroupMenuProps> = ({ className, buttonClassName }) => {
  const _ = useTranslation();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { envConfig } = useEnv();
  const { settings } = useSettingsStore();

  const groupBy = settings.libraryGroupBy;

  const groupByOptions = [
    { label: _('None'), value: LibraryGroupByType.None },
    { label: _('Manual'), value: LibraryGroupByType.Manual },
    { label: _('Series'), value: LibraryGroupByType.Series },
    { label: _('Author'), value: LibraryGroupByType.Author },
  ];

  const handleSetGroupBy = async (value: LibraryGroupByType) => {
    await saveSysSettings(envConfig, 'libraryGroupBy', value);

    const params = new URLSearchParams(searchParams?.toString());
    if (value === LibraryGroupByType.Manual) {
      params.delete('groupBy');
    } else {
      params.set('groupBy', value);
    }
    // Clear group navigation when changing groupBy mode
    params.delete('group');
    navigateToLibrary(router, `${params.toString()}`);
  };

  const currentLabel = groupByOptions.find((o) => o.value === groupBy)?.label || _('None');

  return (
    <Dropdown
      label={_('Group by...')}
      className={className}
      buttonClassName={buttonClassName}
      toggleButton={
        <div className='flex items-center space-x-1 px-2 text-sm font-medium'>
          <span className='text-base-content/50 whitespace-nowrap'>{_('Group By')}:</span>
          <span className='truncate'>{currentLabel}</span>
        </div>
      }
    >
      <Menu className='view-menu dropdown-content no-triangle z-20 mt-2 shadow-2xl'>
        <MenuItem label={_('Group by...')} buttonClass='h-8' labelClass='text-sm sm:text-xs' disabled />
        {groupByOptions.map((option) => (
          <MenuItem
            key={option.value}
            label={option.label}
            buttonClass='h-8'
            toggled={groupBy === option.value}
            onClick={() => handleSetGroupBy(option.value as LibraryGroupByType)}
            transient
          />
        ))}
      </Menu>
    </Dropdown>
  );
};

export default GroupMenu;
