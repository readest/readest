import React, { useEffect } from 'react';
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
import { getStoragePlanData } from '@/utils/access';
import { QuotaType } from '@/types/user';
import MenuItem from '@/components/MenuItem';
import Quota from '@/components/Quota';

interface BookMenuProps {
  setIsDropdownOpen?: (isOpen: boolean) => void;
}

const SettingsMenu: React.FC<BookMenuProps> = ({ setIsDropdownOpen }) => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig } = useEnv();
  const { token, user, logout } = useAuth();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [quotas, setQuotas] = React.useState<QuotaType[]>([]);

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

  useEffect(() => {
    if (!user || !token) return;
    const storagPlan = getStoragePlanData(token);
    const storageQuota: QuotaType = {
      name: _('Storage'),
      tooltip: _('{{percentage}}% of Cloud Storage Used.', {
        percentage: Math.round((storagPlan.usage / storagPlan.quota) * 100),
      }),
      used: Math.round(storagPlan.usage / 1024 / 1024),
      total: Math.round(storagPlan.quota / 1024 / 1024),
      unit: 'MB',
    };
    setQuotas([storageQuota]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const isWebApp = isWebAppPlatform();
  const avatarUrl = user?.user_metadata?.['picture'] || user?.user_metadata?.['avatar_url'];
  const userFullName = user?.user_metadata?.['full_name'];
  const userDisplayName = userFullName ? userFullName.split(' ')[0] : null;

  return (
    <div
      tabIndex={0}
      className='settings-menu dropdown-content no-triangle border-base-100 z-20 mt-3 w-72 shadow-2xl'
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
              <PiUserCircleCheck />
            )
          }
        >
          <ul>
            <Quota quotas={quotas} />
            <MenuItem label={_('Sign Out')} noIcon onClick={handleUserLogout} />
          </ul>
        </MenuItem>
      ) : (
        <MenuItem label={_('Sign In')} icon={<PiUserCircle />} onClick={handleUserLogin}></MenuItem>
      )}
      <hr className='border-base-200 my-1' />
      {isWebApp && <MenuItem label={_('Download Readest')} onClick={downloadReadest} />}
      <MenuItem label={_('About Readest')} onClick={showAboutReadest} />
    </div>
  );
};

export default SettingsMenu;
