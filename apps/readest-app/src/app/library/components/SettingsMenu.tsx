import clsx from 'clsx';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PiUserCircle } from 'react-icons/pi';
import { PiUserCircleCheck } from 'react-icons/pi';
import { MdCheck } from 'react-icons/md';
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

interface SettingsMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const SettingsMenu: React.FC<SettingsMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { user } = useAuth();
  const { themeMode, setThemeMode } = useThemeStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [isAutoUpload, setIsAutoUpload] = useState(settings.autoUpload);
  const [isAutoCheckUpdates, setIsAutoCheckUpdates] = useState(settings.autoCheckUpdates);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(settings.alwaysOnTop);
  const [isScreenWakeLock, setIsScreenWakeLock] = useState(settings.screenWakeLock);
  const [isOpenLastBooks, setIsOpenLastBooks] = useState(settings.openLastBooks);
  const [isAutoImportBooksOnOpen, setIsAutoImportBooksOnOpen] = useState(
    settings.autoImportBooksOnOpen,
  );
  const [isTelemetryEnabled, setIsTelemetryEnabled] = useState(settings.telemetryEnabled);
  const iconSize = useResponsiveSize(16);

  const { quotas } = useQuotaStats();

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

  const toggleAlwaysOnTop = () => {
    settings.alwaysOnTop = !settings.alwaysOnTop;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsAlwaysOnTop(settings.alwaysOnTop);
    tauriHandleSetAlwaysOnTop(settings.alwaysOnTop);
    setIsDropdownOpen?.(false);
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

  const avatarUrl = user?.user_metadata?.['picture'] || user?.user_metadata?.['avatar_url'];
  const userFullName = user?.user_metadata?.['full_name'];
  const userDisplayName = userFullName ? userFullName.split(' ')[0] : null;

  return (
    <div
      tabIndex={0}
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
          Icon={
            avatarUrl ? (
              <UserAvatar url={avatarUrl} size={iconSize} DefaultIcon={PiUserCircleCheck} />
            ) : (
              PiUserCircleCheck
            )
          }
        >
          <ul>
            <Quota quotas={quotas} labelClassName='h-10 pl-3 pr-2' />
            <MenuItem label={_('Account')} noIcon onClick={handleUserProfile} />
          </ul>
        </MenuItem>
      ) : (
        <MenuItem label={_('Sign In')} Icon={PiUserCircle} onClick={handleUserLogin}></MenuItem>
      )}
      <MenuItem
        label={_('Auto Upload Books to Cloud')}
        Icon={isAutoUpload ? MdCheck : undefined}
        onClick={toggleAutoUploadBooks}
      />
      {isTauriAppPlatform() && !appService?.isMobile && (
        <MenuItem
          label={_('Auto Import on File Open')}
          Icon={isAutoImportBooksOnOpen ? MdCheck : undefined}
          onClick={toggleAutoImportBooksOnOpen}
        />
      )}
      {isTauriAppPlatform() && (
        <MenuItem
          label={_('Open Last Book on Start')}
          Icon={isOpenLastBooks ? MdCheck : undefined}
          onClick={toggleOpenLastBooks}
        />
      )}
      {appService?.hasUpdater && (
        <MenuItem
          label={_('Check Updates on Start')}
          Icon={isAutoCheckUpdates ? MdCheck : undefined}
          onClick={toggleAutoCheckUpdates}
        />
      )}
      <hr className='border-base-200 my-1' />
      {appService?.hasWindow && <MenuItem label={_('Fullscreen')} onClick={handleFullScreen} />}
      {appService?.hasWindow && (
        <MenuItem
          label={_('Always on Top')}
          Icon={isAlwaysOnTop ? MdCheck : undefined}
          onClick={toggleAlwaysOnTop}
        />
      )}
      <MenuItem
        label={_('Keep Screen Awake')}
        Icon={isScreenWakeLock ? MdCheck : undefined}
        onClick={toggleScreenWakeLock}
      />
      <MenuItem label={_('Reload Page')} onClick={handleReloadPage} />
      <MenuItem
        label={
          themeMode === 'dark'
            ? _('Dark Mode')
            : themeMode === 'light'
              ? _('Light Mode')
              : _('Auto Mode')
        }
        Icon={themeMode === 'dark' ? BiMoon : themeMode === 'light' ? BiSun : TbSunMoon}
        onClick={cycleThemeMode}
      />
      <hr className='border-base-200 my-1' />
      {isWebAppPlatform() && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
      <MenuItem
        label={_('Help improve Readest')}
        description={isTelemetryEnabled ? _('Sharing anonymized statistics') : ''}
        Icon={isTelemetryEnabled ? MdCheck : undefined}
        onClick={toggleTelemetry}
      />
    </div>
  );
};

export default SettingsMenu;
