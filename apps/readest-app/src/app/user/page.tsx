'use client';

import clsx from 'clsx';
import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { useUserActions } from '@/hooks/useUserActions';
import { useAvailablePlans } from '@/hooks/useAvailablePlans';
import { PlanType } from '@/types/quota';
import { navigateToLibrary } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { isTauriAppPlatform } from '@/services/environment';
import { getPlanDetails } from './utils/plan';
import { Toast } from '@/components/Toast';
import {
  purchaseIAPProduct,
  restoreIAPPurchases,
  getSubscriptionSuccessUrl as getIAPSubscriptionSuccessUrl,
} from '@/libs/payment/iap/client';
import {
  createStripeCheckoutSession,
  redirectToStripeCheckout,
  createStripePortalSession,
  redirectToStripePortal,
  handleStripeCheckoutError,
  getSubscriptionSuccessUrl as getStripeSubscriptionSuccessUrl,
  StripeAvailablePlan,
} from '@/libs/payment/stripe/client';
import LegalLinks from '@/components/LegalLinks';
import Spinner from '@/components/Spinner';
import ProfileHeader from './components/Header';
import UserInfo from './components/UserInfo';
import UsageStats from './components/UsageStats';
import PlansComparison from './components/PlansComparison';
import AccountActions from './components/AccountActions';
import Checkout from './components/Checkout';
import { isPurchaseProduct } from '@/libs/payment/iap/utils';

type CheckoutState = {
  clientSecret: string;
  sessionId: string;
  planName: string;
};

const ProfilePage = () => {
  const _ = useTranslation();
  const router = useRouter();
  const { appService } = useEnv();
  const { token, user } = useAuth();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();

  const [loading, setLoading] = useState(false);
  const [showEmbeddedCheckout, setShowEmbeddedCheckout] = useState(false);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    clientSecret: '',
    sessionId: '',
    planName: '',
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useTheme({ systemUIVisible: false });

  const { quotas, userProfilePlan = 'free' } = useQuotaStats();
  const { handleLogout, handleResetPassword, handleConfirmDelete } = useUserActions();

  const { availablePlans } = useAvailablePlans({
    hasIAP: appService?.hasIAP || false,
    onError: useCallback(
      (message: string) => {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _(message),
        });
      },
      [_],
    ),
  });

  const handleGoBack = () => {
    if (showEmbeddedCheckout) {
      setShowEmbeddedCheckout(false);
    } else {
      navigateToLibrary(router);
    }
  };

  const handleStripeSubscribe = async (productId?: string, planType: PlanType = 'subscription') => {
    if (!productId) return;

    setLoading(true);
    try {
      const { sessionId, clientSecret, url } = await createStripeCheckoutSession(
        productId,
        planType,
      );

      const selectedPlan = availablePlans.find(
        (plan) => plan.productId === productId,
      )! as StripeAvailablePlan;
      const planName = selectedPlan.product?.name || selectedPlan.productName;

      const isEmbeddedCheckout = isTauriAppPlatform();
      if (isEmbeddedCheckout && sessionId && clientSecret) {
        setShowEmbeddedCheckout(true);
        setCheckoutState({
          planName,
          clientSecret,
          sessionId,
        });
      } else {
        await redirectToStripeCheckout(sessionId, url);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      handleStripeCheckoutError(errorMessage);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Failed to create checkout session'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleCheckoutSuccess = useCallback(
    (sessionId: string) => {
      setShowEmbeddedCheckout(false);
      router.push(getStripeSubscriptionSuccessUrl(sessionId));
    },
    [router],
  );

  const handleIAPSubscribe = async (productId?: string) => {
    if (!productId) return;

    setLoading(true);
    try {
      const purchase = await purchaseIAPProduct(productId);
      if (purchase) {
        router.push(getIAPSubscriptionSuccessUrl(purchase));
      }
    } catch (error) {
      console.error('IAP purchase error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleIAPRestorePurchase = async () => {
    setLoading(true);
    try {
      const purchases = await restoreIAPPurchases();
      if (purchases.length > 0) {
        purchases
          .filter((p) => !isPurchaseProduct(p.productId))
          .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
        const purchase = purchases[0]!;
        router.push(getIAPSubscriptionSuccessUrl(purchase));
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
    try {
      const url = await createStripePortalSession();
      await redirectToStripePortal(url);
    } catch (error) {
      console.error('Error creating portal session:', error);
      eventDispatcher.dispatch('toast', {
        type: 'info',
        message: _('Failed to manage subscription.'),
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteWithMessage = () => {
    handleConfirmDelete(_('Failed to delete user. Please try again later.'));
  };

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
  const userPlanDetails =
    getPlanDetails(userProfilePlan, availablePlans) || getPlanDetails('free', availablePlans);

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
              <Spinner loading className='text-gray-900' />
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
                    planDetails={userPlanDetails}
                  />

                  <UsageStats quotas={quotas} />
                </div>

                <div className='flex flex-col gap-y-8 sm:px-6'>
                  <PlansComparison
                    availablePlans={availablePlans}
                    userPlan={userProfilePlan}
                    onSubscribe={appService.hasIAP ? handleIAPSubscribe : handleStripeSubscribe}
                  />
                </div>

                <div className='flex flex-col gap-y-8 px-6'>
                  <AccountActions
                    userPlan={userProfilePlan}
                    onLogout={handleLogout}
                    onResetPassword={handleResetPassword}
                    onConfirmDelete={handleDeleteWithMessage}
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
