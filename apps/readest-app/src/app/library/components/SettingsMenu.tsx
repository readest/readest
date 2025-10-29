import clsx from 'clsx';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiUserCircle, PiUserCircleCheck, PiGear } from 'react-icons/pi';
import { PiSun, PiMoon } from 'react-icons/pi';
import { TbSunMoon } from 'react-icons/tb';

import { invoke, PermissionState } from '@tauri-apps/api/core';
import { isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useThemeStore } from '@/store/themeStore';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import { useResponsiveSize } from '@/hooks/useResponsiveSize';
import { navigateToLogin, navigateToProfile } from '@/utils/nav';
import { tauriHandleSetAlwaysOnTop, tauriHandleToggleFullScreen } from '@/utils/window';
import { optInTelemetry, optOutTelemetry } from '@/utils/telemetry';
import { setAboutDialogVisible } from '@/components/AboutWindow';
import { setMigrateDataDirDialogVisible } from '@/app/library/components/MigrateDataWindow';
import { saveSysSettings } from '@/helpers/settings';
import UserAvatar from '@/components/UserAvatar';
import MenuItem from '@/components/MenuItem';
import Quota from '@/components/Quota';
import Menu from '@/components/Menu';

interface SettingsMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

interface Permissions {
  postNotification: PermissionState;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { userProfilePlan, quotas } = useQuotaStats(true);
  const { themeMode, setThemeMode } = useThemeStore();
  const { settings, setSettingsDialogOpen } = useSettingsStore();
  const [isAutoUpload, setIsAutoUpload] = useState(settings.autoUpload);
  const [isAutoCheckUpdates, setIsAutoCheckUpdates] = useState(settings.autoCheckUpdates);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(settings.alwaysOnTop);
  const [isAlwaysShowStatusBar, setIsAlwaysShowStatusBar] = useState(settings.alwaysShowStatusBar);
  const [isScreenWakeLock, setIsScreenWakeLock] = useState(settings.screenWakeLock);
  const [isOpenLastBooks, setIsOpenLastBooks] = useState(settings.openLastBooks);
  const [isAutoImportBooksOnOpen, setIsAutoImportBooksOnOpen] = useState(
    settings.autoImportBooksOnOpen,
  );
  const [isTelemetryEnabled, setIsTelemetryEnabled] = useState(settings.telemetryEnabled);
  const [alwaysInForeground, setAlwaysInForeground] = useState(settings.alwaysInForeground);
  const [savedBookCoverForLockScreen, setSavedBookCoverForLockScreen] = useState(
    settings.savedBookCoverForLockScreen || '',
  );
  const iconSize = useResponsiveSize(16);

  const showAboutReadest = () => {
    setAboutDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const downloadReadest = () => {
    window.open(DOWNLOAD_READEST_URL, '_blank');
    setIsDropdownOpen?.(false);
  };

  const handleUserLogin = () => {
    navigateToLogin(router);
    setIsDropdownOpen?.(false);
  };

  const handleUserProfile = () => {
    navigateToProfile(router);
    setIsDropdownOpen?.(false);
  };

  const cycleThemeMode = () => {
    const nextMode = themeMode === 'auto' ? 'light' : themeMode === 'light' ? 'dark' : 'auto';
    setThemeMode(nextMode);
  };

  const handleReloadPage = () => {
    window.location.reload();
    setIsDropdownOpen?.(false);
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

  const toggleAutoUploadBooks = () => {
    const newValue = !settings.autoUpload;
    saveSysSettings(envConfig, 'autoUpload', newValue);
    setIsAutoUpload(newValue);

    if (newValue && !user) {
      navigateToLogin(router);
    }
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

  const toggleScreenWakeLock = () => {
    const newValue = !settings.screenWakeLock;
    saveSysSettings(envConfig, 'screenWakeLock', newValue);
    setIsScreenWakeLock(newValue);
  };

  const toggleOpenLastBooks = () => {
    const newValue = !settings.openLastBooks;
    saveSysSettings(envConfig, 'openLastBooks', newValue);
    setIsOpenLastBooks(newValue);
  };

  const toggleTelemetry = () => {
    const newValue = !settings.telemetryEnabled;
    saveSysSettings(envConfig, 'telemetryEnabled', newValue);
    setIsTelemetryEnabled(newValue);
    if (newValue) {
      optInTelemetry();
    } else {
      optOutTelemetry();
    }
  };

  const handleUpgrade = () => {
    navigateToProfile(router);
    setIsDropdownOpen?.(false);
  };

  const handleSetRootDir = () => {
    setMigrateDataDirDialogVisible(true);
    setIsDropdownOpen?.(false);
  };

  const openSettingsDialog = () => {
    setIsDropdownOpen?.(false);
    setSettingsDialogOpen(true);
  };

  const handleSetSavedBookCoverForLockScreen = () => {
    const newValue = settings.savedBookCoverForLockScreen ? '' : 'default';
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

  const avatarUrl = user?.user_metadata?.['picture'] || user?.user_metadata?.['avatar_url'];
  const userFullName = user?.user_metadata?.['full_name'];
  const userDisplayName = userFullName ? userFullName.split(' ')[0] : null;
  const themeModeLabel =
    themeMode === 'dark'
      ? _('Dark Mode')
      : themeMode === 'light'
        ? _('Light Mode')
        : _('Auto Mode');

  return (
    <Menu
      className={clsx(
        'settings-menu dropdown-content no-triangle border-base-100',
        'z-20 mt-2 max-w-[90vw] shadow-2xl',
      )}
    >
      {user ? (
        <MenuItem
          label={
            userDisplayName
              ? _('Logged in as {{userDisplayName}}', { userDisplayName })
              : _('Logged in')
          }
          labelClass='!max-w-40'
          aria-label={_('View account details and quota')}
          Icon={
            avatarUrl ? (
              <UserAvatar url={avatarUrl} size={iconSize} DefaultIcon={PiUserCircleCheck} />
            ) : (
              PiUserCircleCheck
            )
          }
        >
          <ul className='flex flex-col'>
            <button onClick={handleUserProfile} className='w-full'>
              <Quota quotas={quotas} labelClassName='h-10 pl-3 pr-2' />
            </button>
            <MenuItem label={_('Account')} noIcon onClick={handleUserProfile} />
          </ul>
        </MenuItem>
      ) : (
        <MenuItem label={_('Sign In')} Icon={PiUserCircle} onClick={handleUserLogin}></MenuItem>
      )}
      <MenuItem
        label={_('Auto Upload Books to Cloud')}
        toggled={isAutoUpload}
        onClick={toggleAutoUploadBooks}
      />
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
      <MenuItem
        label={_('Keep Screen Awake')}
        toggled={isScreenWakeLock}
        onClick={toggleScreenWakeLock}
      />
      {appService?.isAndroidApp && (
        <MenuItem
          label={_(_('Background Read Aloud'))}
          toggled={alwaysInForeground}
          onClick={toggleAlwaysInForeground}
        />
      )}
      <MenuItem label={_('Reload Page')} onClick={handleReloadPage} />
      <MenuItem
        label={themeModeLabel}
        Icon={themeMode === 'dark' ? PiMoon : themeMode === 'light' ? PiSun : TbSunMoon}
        onClick={cycleThemeMode}
      />
      <MenuItem label={_('Settings')} Icon={PiGear} onClick={openSettingsDialog} />
      {appService?.canCustomizeRootDir && (
        <>
          <hr aria-hidden='true' className='border-base-200 my-1' />
          <MenuItem label={_('Advanced Settings')}>
            <ul className='flex flex-col'>
              <MenuItem
                label={_('Change Data Location')}
                noIcon={!appService?.isAndroidApp}
                onClick={handleSetRootDir}
              />
              {appService?.isAndroidApp && (
                <MenuItem
                  label={_('Save Book Cover')}
                  tooltip={_('Auto-save last book cover')}
                  description={savedBookCoverForLockScreen ? '💾 Images/last-book-cover.png' : ''}
                  toggled={!!savedBookCoverForLockScreen}
                  onClick={handleSetSavedBookCoverForLockScreen}
                />
              )}
            </ul>
          </MenuItem>
        </>
      )}
      <hr aria-hidden='true' className='border-base-200 my-1' />
      {user && userProfilePlan === 'free' && (
        <MenuItem label={_('Upgrade to Readest Premium')} onClick={handleUpgrade} />
      )}
      {isWebAppPlatform() && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
      <MenuItem
        label={_('Help improve Readest')}
        description={isTelemetryEnabled ? _('Sharing anonymized statistics') : ''}
        toggled={isTelemetryEnabled}
        onClick={toggleTelemetry}
      />
    </Menu>
  );
};

export default SettingsMenu;
