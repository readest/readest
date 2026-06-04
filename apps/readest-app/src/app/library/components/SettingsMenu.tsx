import React, { useState } from 'react';
import clsx from 'clsx';
import { useRouter } from 'next/navigation';
import { PiGear, PiMoon, PiSun } from 'react-icons/pi';
import { TbSunMoon } from 'react-icons/tb';
import { invoke } from '@tauri-apps/api/core';
import {
  setBackupDialogVisible,
  setCacheManagerDialogVisible,
} from '@/app/library/components/Dialogs';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useLibraryStore } from '@/store/libraryStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { tauriHandleSetAlwaysOnTop, tauriHandleToggleFullScreen } from '@/utils/window';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { setMigrateDataDirDialogVisible } from '@/app/library/components/MigrateDataWindow';
import { requestStoragePermission } from '@/utils/permission';
import { saveSysSettings } from '@/helpers/settings';
import { selectDirectory } from '@/utils/bridge';
import MenuItem from '@/components/MenuItem';
import Menu from '@/components/Menu';
import { type AppLockDialogMode, useAppLockStore } from '@/store/appLockStore';

interface SettingsMenuProps {
  onPullLibrary: (refresh?: boolean, resetRetries?: boolean) => void;
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

type Permissions = {
  [key: string]: 'granted' | 'denied' | 'prompt' | 'undetermined';
};

const SettingsMenu: React.FC<SettingsMenuProps> = ({ onPullLibrary, setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { themeMode, setThemeMode } = useThemeStore();
  const { settings, setSettingsDialogOpen } = useSettingsStore();
  const [isAutoCheckUpdates, setIsAutoCheckUpdates] = useState(settings.autoCheckUpdates);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(settings.alwaysOnTop);
  const [isAlwaysShowStatusBar, setIsAlwaysShowStatusBar] = useState(settings.alwaysShowStatusBar);
  const [isOpenLastBooks, setIsOpenLastBooks] = useState(settings.openLastBooks);
  const [isAutoImportBooksOnOpen, setIsAutoImportBooksOnOpen] = useState(
    settings.autoImportBooksOnOpen,
  );
  const [alwaysInForeground, setAlwaysInForeground] = useState(settings.alwaysInForeground);
  const [savedBookCoverForLockScreen, setSavedBookCoverForLockScreen] = useState(
    settings.savedBookCoverForLockScreen || '',
  );
  const iconSize = useResponsiveSize(16);

  const [isRefreshingMetadata, setIsRefreshingMetadata] = useState(false);
  const [refreshMetadataProgress, setRefreshMetadataProgress] = useState('');
  const { openDialog: openAppLockDialogInStore } = useAppLockStore();
  const isPinEnabled = !!settings.pinCodeEnabled;

  const openAppLockDialog = (mode: AppLockDialogMode) => {
    openAppLockDialogInStore(mode);
    setIsDropdownOpen?.(false);
  };
  const { setLibrary } = useLibraryStore();

  const showAboutReadest = () => {
    setAboutDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const downloadReadest = () => {
    window.open(DOWNLOAD_READEST_URL, '_blank');
    setIsDropdownOpen?.(false);
  };

  const cycleThemeMode = () => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
  };

  const handleFullScreen = () => {
    tauriHandleToggleFullScreen();
    setIsDropdownOpen?.(false);
  };

  const toggleOpenInNewWindow = () => {
    saveSysSettings(envConfig, 'openBookInNewWindow', !settings.openBookInNewWindow);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysOnTop = () => {
    const newValue = !settings.alwaysOnTop;
    saveSysSettings(envConfig, 'alwaysOnTop', newValue);
    setIsAlwaysOnTop(newValue);
    tauriHandleSetAlwaysOnTop(newValue);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysShowStatusBar = () => {
    const newValue = !settings.alwaysShowStatusBar;
    saveSysSettings(envConfig, 'alwaysShowStatusBar', newValue);
    setIsAlwaysShowStatusBar(newValue);
  };

  const toggleAutoImportBooksOnOpen = () => {
    const newValue = !settings.autoImportBooksOnOpen;
    saveSysSettings(envConfig, 'autoImportBooksOnOpen', newValue);
    setIsAutoImportBooksOnOpen(newValue);
  };

  const toggleAutoCheckUpdates = () => {
    const newValue = !settings.autoCheckUpdates;
    saveSysSettings(envConfig, 'autoCheckUpdates', newValue);
    setIsAutoCheckUpdates(newValue);
  };

  const toggleOpenLastBooks = () => {
    const newValue = !settings.openLastBooks;
    saveSysSettings(envConfig, 'openLastBooks', newValue);
    setIsOpenLastBooks(newValue);
  };

  const handleSetRootDir = () => {
    setMigrateDataDirDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const handleBackupRestore = () => {
    setIsDropdownOpen?.(false);
    setBackupDialogVisible(true);
  };

  const handleManageCache = () => {
    setIsDropdownOpen?.(false);
    setCacheManagerDialogVisible(true);
  };

  const handleRefreshMetadata = async () => {
    if (!appService || isRefreshingMetadata) return;
    setIsRefreshingMetadata(true);
    setRefreshMetadataProgress(_('Loading library...'));
    try {
      const books = await appService.loadLibraryBooks();
      const activeBooks = books.filter((b) => !b.deletedAt);
      let refreshed = 0;
      for (let i = 0; i < activeBooks.length; i++) {
        setRefreshMetadataProgress(`${i + 1} / ${activeBooks.length}`);
        try {
          if (await appService.refreshBookMetadata(activeBooks[i]!)) {
            refreshed++;
          }
        } catch {
          // Skip books whose files can't be opened
        }
      }
      setLibrary(books);
      await appService.saveLibraryBooks(books);
      setRefreshMetadataProgress(_('{{count}} books refreshed', { count: refreshed }));
      onPullLibrary(true);
      setTimeout(() => {
        setIsRefreshingMetadata(false);
        setRefreshMetadataProgress('');
      }, 2000);
    } catch (error) {
      console.error('Failed to refresh metadata:', error);
      setRefreshMetadataProgress(_('Failed to refresh metadata'));
      setTimeout(() => {
        setIsRefreshingMetadata(false);
        setRefreshMetadataProgress('');
      }, 2000);
    }
  };

  const openSettingsDialog = () => {
    setIsDropdownOpen?.(false);
    setSettingsDialogOpen(true);
  };

  const handleSetSavedBookCoverForLockScreen = async () => {
    if (!(await requestStoragePermission()) && appService?.distChannel === 'readest') return;

    const newValue = settings.savedBookCoverForLockScreen ? '' : 'default';
    if (newValue) {
      const response = await selectDirectory();
      if (response.path) {
        saveSysSettings(envConfig, 'savedBookCoverForLockScreenPath', response.path);
      }
    }
    saveSysSettings(envConfig, 'savedBookCoverForLockScreen', newValue);
    setSavedBookCoverForLockScreen(newValue);
  };

  const toggleAlwaysInForeground = async () => {
    const requestAlwaysInForeground = !settings.alwaysInForeground;

    if (requestAlwaysInForeground) {
      let permission = await invoke<Permissions>('plugin:native-tts|checkPermissions');
      if (permission.postNotification !== 'granted') {
        permission = await invoke<Permissions>('plugin:native-tts|requestPermissions', {
          permissions: ['postNotification'],
        });
      }
      if (permission.postNotification !== 'granted') return;
    }

    saveSysSettings(envConfig, 'alwaysInForeground', requestAlwaysInForeground);
    setAlwaysInForeground(requestAlwaysInForeground);
  };

  const themeModeLabel =
    themeMode === 'dark'
      ? _('Dark Mode')
      : themeMode === 'light'
        ? _('Light Mode')
        : _('Auto Mode');

  const savedBookCoverPath = settings.savedBookCoverForLockScreenPath;
  const coverDir = savedBookCoverPath ? savedBookCoverPath.split('/').pop() : 'Images';
  const savedBookCoverDescription = `💾 ${coverDir}/last-book-cover.png`;

  return (
    <Menu
      className={clsx(
        'settings-menu dropdown-content no-triangle',
        'z-20 mt-2 max-w-[90vw] shadow-2xl',
      )}
      onCancel={() => setIsDropdownOpen?.(false)}
    >
      {isTauriAppPlatform() && !appService?.isMobile && (
        <MenuItem
          label={_('Auto Import on File Open')}
          toggled={isAutoImportBooksOnOpen}
          onClick={toggleAutoImportBooksOnOpen}
        />
      )}
      {isTauriAppPlatform() && (
        <MenuItem
          label={_('Open Last Book on Start')}
          toggled={isOpenLastBooks}
          onClick={toggleOpenLastBooks}
        />
      )}
      {appService?.hasUpdater && (
        <MenuItem
          label={_('Check Updates on Start')}
          toggled={isAutoCheckUpdates}
          onClick={toggleAutoCheckUpdates}
        />
      )}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      {appService?.hasWindow && (
        <MenuItem
          label={_('Open Book in New Window')}
          toggled={settings.openBookInNewWindow}
          onClick={toggleOpenInNewWindow}
        />
      )}
      {appService?.hasWindow && <MenuItem label={_('Fullscreen')} onClick={handleFullScreen} />}
      {appService?.hasWindow && (
        <MenuItem label={_('Always on Top')} toggled={isAlwaysOnTop} onClick={toggleAlwaysOnTop} />
      )}
      {appService?.isMobileApp && (
        <MenuItem
          label={_('Always Show Status Bar')}
          toggled={isAlwaysShowStatusBar}
          onClick={toggleAlwaysShowStatusBar}
        />
      )}
      {appService?.isAndroidApp && (
        <MenuItem
          label={_('Background Read Aloud')}
          toggled={alwaysInForeground}
          onClick={toggleAlwaysInForeground}
        />
      )}
      <MenuItem
        label={themeModeLabel}
        Icon={themeMode === 'dark' ? PiMoon : themeMode === 'light' ? PiSun : TbSunMoon}
        onClick={cycleThemeMode}
      />
      <MenuItem label={_('Settings')} Icon={PiGear} onClick={openSettingsDialog} />
      <hr aria-hidden='true' className='border-base-200 my-1' />
      <MenuItem label={_('Advanced Settings')}>
        <ul className='ms-0 flex flex-col ps-0 before:hidden'>
          <MenuItem label={_('Backup & Restore')} onClick={handleBackupRestore} />
          {appService?.canCustomizeRootDir && (
            <MenuItem label={_('Change Data Location')} onClick={handleSetRootDir} />
          )}
          <MenuItem
            label={_('Refresh Metadata')}
            description={refreshMetadataProgress}
            onClick={handleRefreshMetadata}
            disabled={isRefreshingMetadata}
          />
          {appService?.isMobileApp && (
            <MenuItem label={_('Manage Cache')} onClick={handleManageCache} />
          )}
          {!isPinEnabled && (
            <MenuItem
              label={_('Set PIN…')}
              tooltip={_('Require a 4-digit PIN to open Readest')}
              onClick={() => openAppLockDialog('set')}
            />
          )}
          {isPinEnabled && (
            <MenuItem label={_('Change PIN…')} onClick={() => openAppLockDialog('change')} />
          )}
          {isPinEnabled && (
            <MenuItem label={_('Disable PIN…')} onClick={() => openAppLockDialog('disable')} />
          )}
          {appService?.isAndroidApp && appService?.distChannel !== 'playstore' && (
            <MenuItem
              label={_('Save Book Cover')}
              tooltip={_('Auto-save last book cover')}
              description={savedBookCoverForLockScreen ? savedBookCoverDescription : ''}
              toggled={!!savedBookCoverForLockScreen}
              onClick={handleSetSavedBookCoverForLockScreen}
            />
          )}
        </ul>
      </MenuItem>
      <hr aria-hidden='true' className='border-base-200 my-1' />
      {isWebAppPlatform() && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
    </Menu>
  );
};

export default SettingsMenu;
