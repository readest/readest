'use client';

import clsx from 'clsx';
import React, { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { IoArrowBack } from 'react-icons/io5';
import { PiUserCircle } from 'react-icons/pi';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useTrafficLightStore } from '@/store/trafficLightStore';
import { QuotaType, UserPlan } from '@/types/user';
import { getStoragePlanData, getUserPlan } from '@/utils/access';
import { navigateToLibrary } from '@/utils/nav';
import { deleteUser } from '@/libs/user';
import { eventDispatcher } from '@/utils/event';
import { Toast } from '@/components/Toast';
import WindowButtons from '@/components/WindowButtons';
import Quota from '@/components/Quota';

const ProfilePage = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { token, user, logout } = useAuth();
  const { isTrafficLightVisible } = useTrafficLightStore();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const [userPlan, setUserPlan] = useState<UserPlan>('free');
  const [quotas, setQuotas] = React.useState<QuotaType[]>([]);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);

  const headerRef = useRef<HTMLDivElement>(null);

  useTheme();

  useEffect(() => {
    if (!user || !token) return;

    try {
      const userPlan = getUserPlan(token);
      const storagePlan = getStoragePlanData(token);
      const storageQuota = {
        name: _('Cloud Storage'),
        tooltip: _('{{percentage}}% of Cloud Storage Used.', {
          percentage: Math.round((storagePlan.usage / storagePlan.quota) * 100),
        }),
        used: Math.round(storagePlan.usage / 1024 / 1024),
        total: Math.round(storagePlan.quota / 1024 / 1024),
        unit: 'MB',
      };
      setUserPlan(userPlan);
      setQuotas([storageQuota]);
    } catch (error) {
      console.error('Error loading user plan data:', error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleGoBack = () => {
    navigateToLibrary(router);
  };

  const handleLogout = () => {
    logout();
    settings.keepLogin = false;
    setSettings(settings);
    saveSettings(envConfig, settings);
    navigateToLibrary(router);
  };

  const handleDeleteRequest = () => {
    setShowConfirmDelete(true);
  };

  const handleCancelDelete = () => {
    setShowConfirmDelete(false);
  };

  const handleConfirmDelete = async () => {
    try {
      await deleteUser();
      handleLogout();
    } catch (error) {
      console.error('Error deleting user:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to delete user. Please try again later.'),
      });
    }
    setShowConfirmDelete(false);
  };

  const getPlanDetails = (userPlan: UserPlan) => {
    switch (userPlan) {
      case 'free':
        return {
          name: _('Free Tier'),
          color: 'bg-gray-200 text-gray-800',
          features: [
            _('Community Support'),
            _('DeepL Free Access'),
            _('Essential Text-to-Speech Voices'),
            _('Unlimited Offline/Online Reading'),
            _('Unlimited Cloud Sync Devices'),
            _('500 MB Cloud Sync Space'),
          ],
        };
      case 'plus':
        return {
          name: _('Plus Tier'),
          color: 'bg-blue-200 text-blue-800',
          features: [
            _('Includes All Free Tier Benefits'),
            _('Priority Support'),
            _('AI Summaries'),
            _('AI Translations'),
            _('DeepL Pro Access'),
            _('Expanded Text-to-Speech Voices'),
            _('2000 MB Cloud Sync Space'),
          ],
        };
      case 'pro':
        return {
          name: _('Pro Tier'),
          color: 'bg-purple-200 text-purple-800',
          features: [
            _('Includes All Plus Tier Benefits'),
            _('Unlimited AI Summaries'),
            _('Unlimited AI Translations'),
            _('Unlimited DeepL Pro Access'),
            _('Advanced AI Tools'),
            _('Early Feature Access'),
            _('10 GB Cloud Sync Space'),
          ],
        };
    }
  };

  if (!user || !token) {
    return (
      <div className='mx-auto max-w-4xl px-4 py-8'>
        <div className='overflow-hidden rounded-lg shadow-md'>
          <div className='flex min-h-[300px] items-center justify-center p-6'>
            <div className='text-base-content animate-pulse'>{_('Loading profile...')}</div>
          </div>
        </div>
      </div>
    );
  }

  const avatarUrl = user?.user_metadata?.['picture'] || user?.user_metadata?.['avatar_url'];
  const userFullName = user?.user_metadata?.['full_name'] || '-';
  const userEmail = user?.email || '';
  const planDetails = getPlanDetails(userPlan) || getPlanDetails('free');

  return (
    <div
      className={clsx(
        'fixed inset-0 z-0 flex select-none flex-col items-center overflow-y-auto',
        'bg-base-100 border-base-200 border',
        appService?.hasSafeAreaInset && 'pt-[env(safe-area-inset-top)]',
      )}
    >
      <div
        ref={headerRef}
        className={clsx(
          'fixed flex w-full items-center justify-between py-2 pe-6 ps-4',
          appService?.hasTrafficLight && 'pt-11',
        )}
      >
        <button onClick={handleGoBack} className={clsx('btn btn-ghost h-8 min-h-8 w-8 p-0')}>
          <IoArrowBack className='text-base-content' />
        </button>

        {appService?.hasWindowBar && (
          <WindowButtons
            headerRef={headerRef}
            showMinimize={!isTrafficLightVisible}
            showMaximize={!isTrafficLightVisible}
            showClose={!isTrafficLightVisible}
            onClose={handleGoBack}
          />
        )}
      </div>
      <div className='w-full min-w-60 max-w-4xl px-4 py-10'>
        <div className='bg-base-200 overflow-hidden rounded-lg p-2 shadow-md sm:p-6'>
          <div className='p-2 sm:p-6'>
            <div className='mb-8 flex flex-col items-center gap-x-6 gap-y-4 md:flex-row md:items-start'>
              <div className='flex-shrink-0'>
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt={_('User avatar')}
                    className='border-base-100 h-16 w-16 rounded-full border-4 md:h-24 md:w-24'
                    referrerPolicy='no-referrer'
                    width={128}
                    height={128}
                    priority
                  />
                ) : (
                  <PiUserCircle className='h-16 w-16 md:h-24 md:w-24' />
                )}
              </div>

              <div className='flex-grow text-center md:text-left'>
                <h2 className='text-base-content text-xl font-bold md:text-2xl'>{userFullName}</h2>
                <p className='text-base-content/60'>{userEmail}</p>
                <div className='mt-3'>
                  <span
                    className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${planDetails.color}`}
                  >
                    {planDetails.name}
                  </span>
                </div>
              </div>
            </div>

            <div className='bg-base-100 mb-8 rounded-lg px-4 py-6'>
              <h3 className='text-base-content mb-2 text-lg font-semibold'>{_('Features')}</h3>
              <div className='mt-6'>
                <ul className='text-base-content/60 grid grid-cols-1 gap-2 md:grid-cols-2'>
                  {planDetails.features.map((feature, index) => (
                    <li key={index} className='flex items-center'>
                      <svg
                        className='mr-2 h-4 w-4 text-green-500'
                        fill='currentColor'
                        viewBox='0 0 20 20'
                      >
                        <path
                          fillRule='evenodd'
                          d='M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z'
                          clipRule='evenodd'
                        />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className='bg-base-300 mb-8 rounded-lg'>
              <div className='p-0'>
                {quotas && quotas.length > 0 ? (
                  <Quota quotas={quotas} showProgress className='h-10 pl-4 pr-2' />
                ) : (
                  <div className='h-10 animate-pulse'></div>
                )}
              </div>
            </div>

            <div className='flex flex-col gap-4 md:flex-row'>
              <button
                onClick={handleLogout}
                className='w-full rounded-lg bg-gray-200 px-6 py-3 font-medium text-gray-800 transition-colors hover:bg-gray-300 md:w-auto'
              >
                {_('Sign Out')}
              </button>
              <button
                onClick={handleDeleteRequest}
                className='w-full rounded-lg bg-red-100 px-6 py-3 font-medium text-red-600 transition-colors hover:bg-red-200 md:w-auto'
              >
                {_('Delete Account')}
              </button>
            </div>
          </div>
        </div>

        {showConfirmDelete && (
          <div className='fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4'>
            <div className='w-full max-w-md rounded-2xl bg-white p-6'>
              <h3 className='mb-4 text-xl font-bold text-gray-800'>{_('Delete Your Account?')}</h3>
              <p className='mb-6 text-gray-600'>
                {_(
                  'This action cannot be undone. All your data in the cloud will be permanently deleted.',
                )}
              </p>
              <div className='flex flex-col gap-3 sm:flex-row'>
                <button
                  onClick={handleCancelDelete}
                  className='flex-1 rounded-lg bg-gray-300 px-4 py-2 font-medium text-gray-800 hover:bg-gray-400'
                >
                  {_('Cancel')}
                </button>
                <button
                  onClick={handleConfirmDelete}
                  className='flex-1 rounded-lg bg-red-500 px-4 py-2 font-medium text-white hover:bg-red-600'
                >
                  {_('Delete Permanently')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
      <Toast />
    </div>
  );
};

export default ProfilePage;
