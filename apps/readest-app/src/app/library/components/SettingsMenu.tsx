import React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { PiUserCircle } from 'react-icons/pi';
import { PiUserCircleCheck } from 'react-icons/pi';

import { setAboutDialogVisible } from '@/components/AboutWindow';
import { isWebAppPlatform } from '@/services/environment';
import { DOWNLOAD_READEST_URL } from '@/services/constants';
import { useAuth } from '@/context/AuthContext';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';
import MenuItem from '@/components/MenuItem';

interface BookMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const SettingsMenu: React.FC<BookMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig } = useEnv();
  const { user, logout } = useAuth();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const showAboutReadest = () => {
    setAboutDialogVisible(true);
    setIsDropdownOpen?.(false);
  };
  const downloadReadest = () => {
    window.open(DOWNLOAD_READEST_URL, '_blank');
    setIsDropdownOpen?.(false);
  };

  const handleUserLogin = () => {
    router.push('/auth');
    setIsDropdownOpen?.(false);
  };

  const handleUserLogout = () => {
    logout();
    settings.keepLogin = false;
    setSettings(settings);
    saveSettings(envConfig, settings);
    setIsDropdownOpen?.(false);
  };

  const isWebApp = isWebAppPlatform();
  const avatarUrl = user?.user_metadata?.['picture'] || user?.user_metadata?.['avatar_url'];
  const userFullName = user?.user_metadata?.['full_name'];
  const userDisplayName = userFullName ? userFullName.split(' ')[0] : null;

  return (
    <div
      tabIndex={0}
      className='settings-menu dropdown-content no-triangle border-base-100 z-20 mt-3 w-60 shadow-2xl'
    >
      {user ? (
        <MenuItem
          label={
            userDisplayName
              ? _('Logged in as {{userDisplayName}}', { userDisplayName })
              : _('Logged in')
          }
          labelClass='!max-w-40'
          icon={
            avatarUrl ? (
              <Image
                src={avatarUrl}
                alt={_('User avatar')}
                className='h-5 w-5 rounded-full'
                referrerPolicy='no-referrer'
                width={20}
                height={20}
              />
            ) : (
              <PiUserCircleCheck size={20} />
            )
          }
        >
          <ul>
            <MenuItem label={_('Sign Out')} noIcon onClick={handleUserLogout} />
          </ul>
        </MenuItem>
      ) : (
        <MenuItem
          label={_('Sign In')}
          icon={<PiUserCircle size={20} />}
          onClick={handleUserLogin}
        ></MenuItem>
      )}
      <hr className='border-base-200 my-1' />
      {isWebApp && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
    </div>
  );
};

export default SettingsMenu;
