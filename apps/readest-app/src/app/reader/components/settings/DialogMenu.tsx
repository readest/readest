import React from 'react';
import { MdCheck } from 'react-icons/md';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useDefaultIconSize } from '@/hooks/useResponsiveSize';

interface DialogMenuProps {
  toggleDropdown?: () => void;
}

const DialogMenu: React.FC<DialogMenuProps> = ({ toggleDropdown }) => {
  const _ = useTranslation();
  const iconSize = useDefaultIconSize();
  const { isFontLayoutSettingsGlobal, setFontLayoutSettingsGlobal } = useSettingsStore();

  const handleToggleGlobal = () => {
    setFontLayoutSettingsGlobal(!isFontLayoutSettingsGlobal);
    toggleDropdown?.();
  };

  return (
    <div
      tabIndex={0}
      className='dropdown-content dropdown-right no-triangle border-base-200 z-20 mt-1 border shadow-2xl'
    >
      <button
        className='hover:bg-base-200 text-base-content flex w-full items-center justify-between rounded-md p-2'
        onClick={handleToggleGlobal}
      >
        <div className='flex items-center'>
          <span style={{ minWidth: `${iconSize}px` }}>
            {isFontLayoutSettingsGlobal && <MdCheck className='text-base-content' />}
          </span>
          <div
            className='lg:tooltip'
            data-tip={
              isFontLayoutSettingsGlobal ? _('Apply to All Books') : _('Apply to This Book')
            }
          >
            <span className='ml-2 whitespace-nowrap'>{_('Global Settings')}</span>
          </div>
        </div>
      </button>
    </div>
  );
};

export default DialogMenu;
