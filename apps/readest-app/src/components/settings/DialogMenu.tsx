import clsx from 'clsx';
import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useReaderStore } from '@/store/readerStore';
import { useCustomFontStore } from '@/store/customFontStore';
import { saveViewSettings } from '@/helpers/settings';
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
  const { setFontPanelView } = useSettingsStore();
  const { getViewSettings } = useReaderStore();
  const { getAllFonts, removeFont, saveCustomFonts } = useCustomFontStore();
  const viewSettings = getViewSettings(bookKey);
  const isSettingsGlobal = viewSettings?.isGlobal ?? true;

  const handleSetGlobal = (global: boolean) => {
    if (global !== isSettingsGlobal) {
      saveViewSettings(envConfig, bookKey, 'isGlobal', global, true, false);
    }
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
      {/* Two exclusive rows rather than one "Global Settings" checkmark: the
          checkmark named the mode but not the consequence, and the consequence
          only lived in a `lg:tooltip` + native `title`, neither of which fires
          on touch — so on phones and tablets nothing in the app ever said that
          a font change here reaches every book (issue #5932). */}
      <MenuItem
        label={_('Apply to All Books')}
        disabled={!bookKey}
        toggled={isSettingsGlobal}
        onClick={() => handleSetGlobal(true)}
      />
      <MenuItem
        label={_('Apply to This Book')}
        disabled={!bookKey}
        toggled={!isSettingsGlobal}
        onClick={() => handleSetGlobal(false)}
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
