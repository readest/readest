'use client';

import clsx from 'clsx';
import Stripe from 'stripe';
import posthog from 'posthog-js';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { UserPlan } from '@/types/user';
import { navigateToLibrary, navigateToResetPassword } from '@/utils/nav';
import { deleteUser } from '@/libs/user';
import { eventDispatcher } from '@/utils/event';
import { getStripe } from '@/libs/stripe/client';
import { getAPIBaseUrl, isTauriAppPlatform, isWebAppPlatform } from '@/services/environment';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getAccessToken } from '@/utils/access';
import { IAPService, IAPProduct } from '@/utils/iap';
import { getPlanDetails } from './utils/plan';
import { Toast } from '@/components/Toast';
import LegalLinks from '@/components/LegalLinks';
import Spinner from '@/components/Spinner';
import ProfileHeader from './components/Header';
import UserInfo from './components/UserInfo';
import UsageStats from './components/UsageStats';
import PlansComparison from './components/PlansComparison';
import AccountActions from './components/AccountActions';
import Checkout from './components/Checkout';

const WEB_STRIPE_PLANS_URL = `${getAPIBaseUrl()}/stripe/plans`;
const WEB_STRIPE_CHECKOUT_URL = `${getAPIBaseUrl()}/stripe/checkout`;
const WEB_STRIPE_PORTAL_URL = `${getAPIBaseUrl()}/stripe/portal`;
const SUBSCRIPTION_SUCCESS_PATH = '/user/subscription/success';

export type AvailablePlan = {
  plan: UserPlan;
  price_id: string;
  price: number; // in cents
  currency: string;
  interval: string;
  productName: string;
  product?: Stripe.Product;
};

type CheckoutState = {
  clientSecret: string;
  sessionId: string;
  planName: string;
};

const ProfilePage = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { envConfig, appService } = useEnv();
  const { token, user, logout } = useAuth();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();

  const [loading, setLoading] = useState(false);
  const [availablePlans, setAvailablePlans] = useState<AvailablePlan[]>([]);
  const [showEmbeddedCheckout, setShowEmbeddedCheckout] = useState(false);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    clientSecret: '',
    sessionId: '',
    planName: '',
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useTheme({ systemUIVisible: false });

  const { quotas, userPlan = 'free' } = useQuotaStats();

  const handleGoBack = () => {
    if (showEmbeddedCheckout) {
      setShowEmbeddedCheckout(false);
    } else {
      navigateToLibrary(router);
    }
  };

  const handleLogout = () => {
    logout();
    settings.keepLogin = false;
    setSettings(settings);
    saveSettings(envConfig, settings);
    navigateToLibrary(router);
  };

  const handleResetPassword = () => {
    navigateToResetPassword(router);
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

  const handleStripeSubscribe = async (priceId?: string) => {
    const token = await getAccessToken();
    const stripe = await getStripe();
    if (!stripe) {
      console.error('Stripe not loaded');
      return;
    }
    setLoading(true);
    const isEmbeddedCheckout = isTauriAppPlatform();
    const response = await fetch(WEB_STRIPE_CHECKOUT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ priceId, embedded: isEmbeddedCheckout }),
    });
    setLoading(false);
    if (!response.ok) {
      console.error('Failed to create Stripe checkout session');
      posthog.capture('checkout_error', {
        error: 'Failed to create Stripe checkout session',
      });
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Failed to create checkout session'),
      });
      return;
    }
    const { sessionId, clientSecret, url } = await response.json();

    const selectedPlan = availablePlans.find((plan) => plan.price_id === priceId)!;
    const planName = selectedPlan.product?.name || selectedPlan.productName;
    if (isEmbeddedCheckout && sessionId && clientSecret) {
      setShowEmbeddedCheckout(true);
      setCheckoutState({
        planName,
        clientSecret,
        sessionId,
      });
    } else if (url) {
      if (isWebAppPlatform()) {
        window.location.href = url;
      } else if (isTauriAppPlatform()) {
        await openUrl(url);
      }
    } else if (sessionId) {
      const result = await stripe.redirectToCheckout({ sessionId });
      if (result.error) {
        console.error(result.error);
        posthog.capture('checkout_error', {
          error: 'Failed to redirect to checkout',
        });
      }
    } else {
      console.error('No sessionId or url returned from checkout API');
      posthog.capture('checkout_error', {
        error: 'No sessionId or url returned from checkout API',
      });
    }
  };

  const handleCheckoutSuccess = useCallback(
    (sessionId: string) => {
      setShowEmbeddedCheckout(false);
      const params = new URLSearchParams({
        payment: 'stripe',
        session_id: sessionId,
      });
      router.push(`${SUBSCRIPTION_SUCCESS_PATH}?${params.toString()}`);
    },
    [router],
  );

  const handleIAPSubscribe = async (productId?: string) => {
    if (!productId) return;

    setLoading(true);
    const iapService = new IAPService();
    try {
      const purchase = await iapService.purchaseProduct(productId);
      if (purchase) {
        const params = new URLSearchParams({
          payment: 'iap',
          platform: purchase.platform,
          transaction_id: purchase.transactionId,
          original_transaction_id: purchase.originalTransactionId,
        });
        router.push(`${SUBSCRIPTION_SUCCESS_PATH}?${params.toString()}`);
      }
    } catch (error) {
      console.error('IAP purchase error:', error);
    }
    setLoading(false);
  };

  const handleIAPRestorePurchase = async () => {
    setLoading(true);
    const iapService = new IAPService();
    try {
      const purchases = await iapService.restorePurchases();
      if (purchases.length > 0) {
        purchases.sort(
          (a, b) => new Date(a.purchaseDate).getTime() - new Date(b.purchaseDate).getTime(),
        );
        const purchase = purchases[0]!;
        const params = new URLSearchParams({
          payment: 'iap',
          platform: purchase.platform,
          transaction_id: purchase.transactionId,
          original_transaction_id: purchase.originalTransactionId,
        });
        router.push(`${SUBSCRIPTION_SUCCESS_PATH}?${params.toString()}`);
      } else {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('No purchases found to restore.'),
        });
      }
    } catch (error) {
      console.error('Failed to restore purchases:', error);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Failed to restore purchases.'),
      });
    }
    setLoading(false);
  };

  const handleManageSubscription = async () => {
    setLoading(true);
    const token = await getAccessToken();
    const response = await fetch(WEB_STRIPE_PORTAL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });
    setLoading(false);

    const { url, error } = await response.json();

    if (error) {
      console.error('Error creating portal session:', error);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Failed to manage subscription.'),
      });
      return;
    }

    if (isWebAppPlatform()) {
      window.location.href = url;
    } else if (isTauriAppPlatform()) {
      await openUrl(url);
    }
  };

  useEffect(() => {
    if (!appService) return;

    if (appService?.isIOSApp) {
      const iapService = new IAPService();
      iapService
        .initialize()
        .then(() =>
          iapService.fetchProducts([
            'com.bilingify.readest.monthly.plus',
            'com.bilingify.readest.monthly.pro',
          ]),
        )
        .then((products: IAPProduct[]) => {
          const availablePlans: AvailablePlan[] = products.map((product) => ({
            plan: product.id.includes('plus')
              ? 'plus'
              : product.id.includes('pro')
                ? 'pro'
                : 'free',
            price_id: product.id,
            price: product.priceAmountMicros / 10000,
            currency: product.priceCurrencyCode || 'USD',
            interval: 'month',
            productName: product.title,
          }));
          setAvailablePlans(availablePlans);
        })
        .catch((error) => {
          console.error('Failed to fetch IAP products:', error);
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('Failed to load subscription plans.'),
          });
        });
    } else {
      fetch(WEB_STRIPE_PLANS_URL)
        .then((res) => res.json())
        .then((data) => {
          const availablePlans = data && data instanceof Array ? data : [];
          setAvailablePlans(availablePlans);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appService]);

  if (!mounted) {
    return null;
  }

  if (!user || !token || !appService) {
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
        'bg-base-100 inset-0 h-[100vh] select-none overflow-hidden',
        appService?.hasRoundedWindow && isRoundedWindow && 'window-border rounded-window',
      )}
    >
      <div
        className={clsx('flex h-full w-full flex-col items-center overflow-y-auto')}
        style={{
          paddingTop: `${safeAreaInsets?.top || 0}px`,
        }}
      >
        <ProfileHeader onGoBack={handleGoBack} />
        <div className='w-full min-w-60 max-w-4xl py-10'>
          {loading && (
            <div className='fixed inset-0 z-50 flex items-center justify-center'>
              <Spinner loading />
            </div>
          )}
          {showEmbeddedCheckout ? (
            <div className='bg-base-100 rounded-lg p-4'>
              <Checkout
                clientSecret={checkoutState.clientSecret}
                sessionId={checkoutState.sessionId}
                planName={checkoutState.planName}
                onSuccess={handleCheckoutSuccess}
              />
            </div>
          ) : (
            <div className='sm:bg-base-200 overflow-hidden rounded-lg sm:p-6 sm:shadow-md'>
              <div className='flex flex-col gap-y-8'>
                <div className='flex flex-col gap-y-8 px-6'>
                  <UserInfo
                    avatarUrl={avatarUrl}
                    userFullName={userFullName}
                    userEmail={userEmail}
                    planDetails={planDetails}
                  />

                  <UsageStats quotas={quotas} />
                </div>

                <div className='flex flex-col gap-y-8 sm:px-6'>
                  <PlansComparison
                    availablePlans={availablePlans}
                    userPlan={userPlan}
                    onSubscribe={appService.isIOSApp ? handleIAPSubscribe : handleStripeSubscribe}
                  />
                </div>

                <div className='flex flex-col gap-y-8 px-6'>
                  <AccountActions
                    userPlan={userPlan}
                    onLogout={handleLogout}
                    onResetPassword={handleResetPassword}
                    onConfirmDelete={handleConfirmDelete}
                    onRestorePurchase={handleIAPRestorePurchase}
                    onManageSubscription={handleManageSubscription}
                  />
                </div>
                <LegalLinks />
              </div>
            </div>
          )}
        </div>
        <Toast />
      </div>
    </div>
  );
};

export default ProfilePage;
