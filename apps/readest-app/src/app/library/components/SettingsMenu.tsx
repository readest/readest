import clsx from 'clsx';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiUserCircle } from 'react-icons/pi';
import { PiUserCircleCheck } from 'react-icons/pi';
import { TbSunMoon } from 'react-icons/tb';
import { BiMoon, BiSun } from 'react-icons/bi';

import { setAboutDialogVisible } from '@/components/AboutWindow';
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
import UserAvatar from '@/components/UserAvatar';
import MenuItem from '@/components/MenuItem';
import Quota from '@/components/Quota';
import Menu from '@/components/Menu';

interface SettingsMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { userPlan, quotas } = useQuotaStats(true);
  const { themeMode, setThemeMode } = useThemeStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
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
    settings.openBookInNewWindow = !settings.openBookInNewWindow;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysOnTop = () => {
    settings.alwaysOnTop = !settings.alwaysOnTop;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsAlwaysOnTop(settings.alwaysOnTop);
    tauriHandleSetAlwaysOnTop(settings.alwaysOnTop);
    setIsDropdownOpen?.(false);
  };

  const toggleAlwaysShowStatusBar = () => {
    settings.alwaysShowStatusBar = !settings.alwaysShowStatusBar;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsAlwaysShowStatusBar(settings.alwaysShowStatusBar);
  };

  const toggleAutoUploadBooks = () => {
    settings.autoUpload = !settings.autoUpload;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsAutoUpload(settings.autoUpload);

    if (settings.autoUpload && !user) {
      navigateToLogin(router);
    }
  };

  const toggleAutoImportBooksOnOpen = () => {
    settings.autoImportBooksOnOpen = !settings.autoImportBooksOnOpen;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsAutoImportBooksOnOpen(settings.autoImportBooksOnOpen);
  };

  const toggleAutoCheckUpdates = () => {
    settings.autoCheckUpdates = !settings.autoCheckUpdates;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsAutoCheckUpdates(settings.autoCheckUpdates);
  };

  const toggleScreenWakeLock = () => {
    settings.screenWakeLock = !settings.screenWakeLock;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsScreenWakeLock(settings.screenWakeLock);
  };

  const toggleOpenLastBooks = () => {
    settings.openLastBooks = !settings.openLastBooks;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsOpenLastBooks(settings.openLastBooks);
  };

  const toggleTelemetry = () => {
    settings.telemetryEnabled = !settings.telemetryEnabled;
    if (settings.telemetryEnabled) {
      optInTelemetry();
    } else {
      optOutTelemetry();
    }
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsTelemetryEnabled(settings.telemetryEnabled);
  };

  const handleUpgrade = () => {
    navigateToProfile(router);
    setIsDropdownOpen?.(false);
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
      label={_('Settings Menu')}
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
      <hr className='border-base-200 my-1' />
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
      <MenuItem label={_('Reload Page')} onClick={handleReloadPage} />
      <MenuItem
        label={themeModeLabel}
        Icon={themeMode === 'dark' ? BiMoon : themeMode === 'light' ? BiSun : TbSunMoon}
        onClick={cycleThemeMode}
      />
      <hr className='border-base-200 my-1' />
      {user && userPlan === 'free' && !appService?.isIOSApp && (
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
