import clsx from 'clsx';
import React from 'react';
import { MdCheck } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useCustomFontStore } from '@/store/customFontStore';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { SettingsPanelType } from './SettingsDialog';
import MenuItem from '@/components/MenuItem';

interface DialogMenuProps {
  activePanel: SettingsPanelType;
  setIsDropdownOpen?: (open: boolean) => void;
  onReset: () => void;
  resetLabel?: string;
}

const DialogMenu: React.FC<DialogMenuProps> = ({
  activePanel,
  setIsDropdownOpen,
  onReset,
  resetLabel,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
  const iconSize = useResponsiveSize(16);
  const { setFontPanelView, isSettingsGlobal, setSettingsGlobal } = useSettingsStore();
  const { getAllFonts, removeFont, saveCustomFonts } = useCustomFontStore();

  const handleToggleGlobal = () => {
    setSettingsGlobal(!isSettingsGlobal);
    setIsDropdownOpen?.(false);
  };

  const handleResetToDefaults = () => {
    onReset();
    setIsDropdownOpen?.(false);
  };

  const handleManageCustomFont = () => {
    setFontPanelView('custom-fonts');
    setIsDropdownOpen?.(false);
  };

  const handleClearCustomFont = () => {
    getAllFonts().forEach((font) => {
      if (removeFont(font.id)) {
        appService!.deleteFont(font);
      }
    });
    saveCustomFonts(envConfig);
    setIsDropdownOpen?.(false);
  };

  return (
    <div
      className={clsx(
        'dropdown-content dropdown-right no-triangle border-base-200 z-20 mt-1 border shadow-2xl',
        'text-base sm:text-sm',
      )}
    >
      <MenuItem
        label={_('Global Settings')}
        tooltip={isSettingsGlobal ? _('Apply to All Books') : _('Apply to This Book')}
        buttonClass='lg:tooltip'
        Icon={isSettingsGlobal ? <MdCheck size={iconSize} className='text-base-content' /> : null}
        onClick={handleToggleGlobal}
      />
      <MenuItem label={resetLabel || _('Reset Settings')} onClick={handleResetToDefaults} />
      {activePanel === 'Font' && (
        <>
          <MenuItem label={_('Clear Custom Fonts')} onClick={handleClearCustomFont} />
          <MenuItem label={_('Manage Custom Fonts')} onClick={handleManageCustomFont} />
        </>
      )}
    </div>
  );
};

export default DialogMenu;
