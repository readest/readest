import clsx from 'clsx';
import React from 'react';
import { MdCheck } from 'react-icons/md';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useCustomFontStore } from '@/store/customFontStore';
import { SettingsPanelType } from './SettingsDialog';
import Menu from '@/components/Menu';
import MenuItem from '@/components/MenuItem';

interface DialogMenuProps {
  bookKey: string;
  activePanel: SettingsPanelType;
  setIsDropdownOpen?: (open: boolean) => void;
  onReset: () => void;
  resetLabel?: string;
}

const DialogMenu: React.FC<DialogMenuProps> = ({
  bookKey,
  activePanel,
  setIsDropdownOpen,
  onReset,
  resetLabel,
}) => {
  const _ = useTranslation();
  const { envConfig, appService } = useEnv();
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
    <Menu className={clsx('dialog-menu dropdown-content no-triangle z-20 mt-2 shadow-2xl')}>
      <MenuItem
        label={_('Global Settings')}
        tooltip={isSettingsGlobal ? _('Apply to All Books') : _('Apply to This Book')}
        disabled={!bookKey}
        buttonClass='lg:tooltip'
        Icon={isSettingsGlobal ? MdCheck : null}
        onClick={handleToggleGlobal}
      />
      <MenuItem label={resetLabel || _('Reset Settings')} onClick={handleResetToDefaults} />
      {activePanel === 'Font' && (
        <>
          <MenuItem label={_('Clear Custom Fonts')} onClick={handleClearCustomFont} />
          <MenuItem label={_('Manage Custom Fonts')} onClick={handleManageCustomFont} />
        </>
      )}
    </Menu>
  );
};

export default DialogMenu;
