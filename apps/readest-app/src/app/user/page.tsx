'use client';

import clsx from 'clsx';
import Stripe from 'stripe';
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { UserPlan } from '@/types/user';
import { navigateToLibrary } from '@/utils/nav';
import { deleteUser } from '@/libs/user';
import { eventDispatcher } from '@/utils/event';
import { getStripe } from '@/libs/stripe/client';
import { getAPIBaseUrl } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { getPlanDetails } from './utils/plan';
import { Toast } from '@/components/Toast';
import ProfileHeader from './components/Header';
import UserInfo from './components/UserInfo';
import UsageStats from './components/UsageStats';
import PlansComparison from './components/PlansComparison';
import AccountActions from './components/AccountActions';

const WEB_STRIPE_PLANS_URL = `${getAPIBaseUrl()}/stripe/plans`;
const WEB_STRIPE_CHECKOUT_URL = `${getAPIBaseUrl()}/stripe/checkout`;
const WEB_STRIPE_PORTAL_URL = `${getAPIBaseUrl()}/stripe/portal`;

export type AvailablePlan = {
  plan: UserPlan;
  price_id: string;
  price: number;
  currency: string;
  interval: string;
  product: Stripe.Product;
};

const ProfilePage = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { token, user, logout } = useAuth();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const [availablePlans, setAvailablePlans] = useState<AvailablePlan[]>([]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useTheme({ systemUIVisible: false });

  const { quotas, userPlan } = useQuotaStats();

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
  };

  const handleSubscribe = async (priceId?: string) => {
    const token = await getAccessToken();
    const stripe = await getStripe();
    if (!stripe) {
      console.error('Stripe not loaded');
      return;
    }
    const { sessionId, url } = await fetch(WEB_STRIPE_CHECKOUT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ priceId }),
    }).then((res) => res.json());

    if (url) {
      window.location.href = url;
    } else {
      const result = await stripe.redirectToCheckout({ sessionId });

      if (result.error) {
        console.error(result.error);
      }
    }
  };

  const handleManageSubscription = async () => {
    const token = await getAccessToken();
    const response = await fetch(WEB_STRIPE_PORTAL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    const { url, error } = await response.json();

    if (error) {
      console.error('Error creating portal session:', error);
      eventDispatcher.dispatch('toast', {
        type: 'error',
        message: _('Failed to manage subscription. Please try again later.'),
      });
      return;
    }

    window.location.href = url;
  };

  useEffect(() => {
    fetch(WEB_STRIPE_PLANS_URL)
      .then((res) => res.json())
      .then((data) => setAvailablePlans(data));
  }, []);

  if (!mounted) {
    return null;
  }

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
  const planDetails =
    getPlanDetails(userPlan, availablePlans) || getPlanDetails('free', availablePlans);

  return (
    <div
      className={clsx(
        'fixed inset-0 z-0 flex select-none flex-col items-center overflow-y-auto',
        'bg-base-100 border-base-200 border',
        appService?.hasSafeAreaInset && 'pt-[env(safe-area-inset-top)]',
      )}
    >
      <ProfileHeader onGoBack={handleGoBack} />
      <div className='w-full min-w-60 max-w-4xl px-4 py-10'>
        <div className='bg-base-200 overflow-hidden rounded-lg p-2 shadow-md sm:p-6'>
          <div className='flex flex-col gap-y-8 p-2 sm:p-6'>
            <UserInfo
              avatarUrl={avatarUrl}
              userFullName={userFullName}
              userEmail={userEmail}
              planDetails={planDetails}
            />

            <UsageStats quotas={quotas} />

            <PlansComparison
              availablePlans={availablePlans}
              userPlan={userPlan}
              onSubscribe={handleSubscribe}
            />

            <AccountActions
              userPlan={userPlan}
              onLogout={handleLogout}
              onConfirmDelete={handleConfirmDelete}
              onManageSubscription={handleManageSubscription}
            />
          </div>
        </div>
      </div>
      <Toast />
    </div>
  );
};

export default ProfilePage;
