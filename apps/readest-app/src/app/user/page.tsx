'use client';

import clsx from 'clsx';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useEnv } from '@/context/EnvContext';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/hooks/useTheme';
import { useThemeStore } from '@/store/themeStore';
import { useReaderStore } from '@/store/readerStore';
import { useQuotaStats } from '@/hooks/useQuotaStats';
import { useTranslation } from '@/hooks/useTranslation';
import { useUserActions } from '@/hooks/useUserActions';
import { useAvailablePlans } from '@/hooks/useAvailablePlans';
import type { PlanType } from '@/types/quota';
import type { GiftCardsResponse, GiftPrice } from '@/types/gift';
import { navigateBackFromProfile } from '@/utils/nav';
import { eventDispatcher } from '@/utils/event';
import { isTauriAppPlatform } from '@/services/environment';
import { getPlanDetails, shouldUseBillingPortal } from './utils/plan';
import { Toast } from '@/components/Toast';
import {
  purchaseIAPProduct,
  restoreIAPPurchases,
  verifyApplePurchaseProducts,
  verifyGooglePurchaseProducts,
  getSubscriptionSuccessUrl as getIAPSubscriptionSuccessUrl,
} from '@/libs/payment/iap/client';
import { isPurchaseProduct } from '@/libs/payment/iap/utils';
import { claimGiftCards, fetchGiftCards, fetchGiftPrices } from '@/libs/payment/gift/client';
import {
  createStripeCheckoutSession,
  redirectToStripeCheckout,
  createStripePortalSession,
  redirectToStripePortal,
  handleStripeCheckoutError,
  getSubscriptionSuccessUrl as getStripeSubscriptionSuccessUrl,
  type StripeAvailablePlan,
  type StripePortalFlow,
} from '@/libs/payment/stripe/client';
import LegalLinks from '@/components/LegalLinks';
import Spinner from '@/components/Spinner';
import ProfileHeader from './components/Header';
import UserInfo from './components/UserInfo';
import UsageStats from './components/UsageStats';
import PlansComparison from './components/PlansComparison';
import AccountActions from './components/AccountActions';
import StorageManager from './components/StorageManager';
import SharedLinksSection from './components/SharedLinksSection';
import { SyncPassphraseSection } from './components/SyncPassphraseSection';
import { SyncDevicesSection } from './components/SyncDevicesSection';
import { SyncCategoriesSection } from './components/SyncCategoriesSection';
import Checkout from './components/Checkout';
import GiftCardsSection, { GiftCardsView } from './components/gift/GiftCardsSection';

type GiftInfo = Pick<GiftCardsResponse, 'giftPlan' | 'giftActiveUntil' | 'giftOnly'>;

type CheckoutState = {
  clientSecret: string;
  sessionId: string;
  planName: string;
};

const ProfilePage = () => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { appService } = useEnv();
  const { token, user, refresh } = useAuth();
  const { safeAreaInsets, isRoundedWindow } = useThemeStore();

  const [loading, setLoading] = useState(false);
  const [showEmbeddedCheckout, setShowEmbeddedCheckout] = useState(false);
  const [showStorageManager, setShowStorageManager] = useState(false);
  const [showSharedLinksManager, setShowSharedLinksManager] = useState(false);
  const searchParams = useSearchParams();
  const [showSyncManager, setShowSyncManager] = useState(
    () => searchParams?.get('section') === 'sync',
  );
  // Read once: the code is taken out of the URL as soon as the page opens.
  const [giftCode] = useState(() => searchParams?.get('gift') || undefined);
  // A gift link opens redeeming; a returning gift checkout opens buying.
  const [giftView, setGiftView] = useState<GiftCardsView | null>(() => {
    const section = searchParams?.get('section');
    if (giftCode || section === 'redeem') return 'redeem';
    return section === 'gifts' ? 'give' : null;
  });
  const [giftInfo, setGiftInfo] = useState<GiftInfo | null>(null);
  const [checkoutState, setCheckoutState] = useState<CheckoutState>({
    clientSecret: '',
    sessionId: '',
    planName: '',
  });

  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const {
    signingOut,
    handleLogout,
    handleResetPassword,
    handleUpdateEmail,
    handleConfirmDelete,
    handleDeleteAllBooks,
  } = useUserActions();

  useEffect(() => {
    if (!mounted) return;

    const isAuthenticated = user && token && appService;
    // Signing out opens the library, not the login page (#7726).
    if (isAuthenticated || signingOut) return;

    const timer = setTimeout(() => {
      // A gift link comes back here after sign-in, with its code.
      const redirect = giftCode
        ? `/user?gift=${encodeURIComponent(giftCode)}`
        : searchParams?.get('redirect') || '/library';
      // Replace, so leaving the login page goes back to the opener (#7567).
      router.replace(`/auth?redirect=${encodeURIComponent(redirect)}`);
    }, 1000);

    return () => clearTimeout(timer);
  }, [mounted, user, token, appService, router, searchParams, signingOut, giftCode]);

  useEffect(() => {
    if (!giftCode) return;
    // Keep the code out of the URL, history and analytics. A reload opens the
    // redeem view without it; the redeem form keeps the code it was given.
    const params = new URLSearchParams(window.location.search);
    params.delete('gift');
    params.set('section', 'redeem');
    router.replace(`${window.location.pathname}?${params}`);
    // Once on open.
  }, []);

  useTheme({ systemUIVisible: false });

  // Only the newest load sets the status: an older answer landing last would
  // put back a stale "gift only" and send a gift holder to the portal.
  const giftLoads = useRef(0);
  const loadGiftInfo = useCallback(async (): Promise<GiftInfo | null> => {
    const mine = ++giftLoads.current;
    try {
      const { giftPlan, giftActiveUntil, giftOnly } = await fetchGiftCards();
      const info = { giftPlan, giftActiveUntil, giftOnly };
      if (mine === giftLoads.current) setGiftInfo(info);
      return info;
    } catch (error) {
      console.error('Failed to load gift cards:', error);
      return null;
    }
  }, []);

  // Claim gifts sent to this account's email, then learn whether a gift is
  // what sets the plan, for the plan cards and Manage Subscription.
  const signedIn = !!(user && token);
  useEffect(() => {
    if (!signedIn) return;
    const claimThenLoad = async () => {
      try {
        if ((await claimGiftCards()) > 0) await refresh();
      } catch (error) {
        console.error('Failed to claim gift cards:', error);
      }
      await loadGiftInfo();
    };
    void claimThenLoad();
  }, [signedIn, refresh, loadGiftInfo]);

  const handleGiftPlanChanged = useCallback(() => {
    void refresh();
    void loadGiftInfo();
  }, [refresh, loadGiftInfo]);

  const { quotas, userProfilePlan = 'free', customizationPurchased } = useQuotaStats();

  // The Gift Card tile shows the lowest and the buy view sells at these, so
  // they load once here. An IAP build sells gifts through its store only:
  // nothing loads until the app service says which, never Stripe meanwhile.
  const [giftPrices, setGiftPrices] = useState<GiftPrice[]>([]);
  const giftsThroughIAP = appService?.hasIAP;
  useEffect(() => {
    if (giftsThroughIAP === undefined) return;
    let stale = false;
    fetchGiftPrices(giftsThroughIAP)
      .then((next) => {
        if (!stale) setGiftPrices(next);
      })
      .catch((error) => console.error('Failed to load gift prices:', error));
    return () => {
      stale = true;
    };
  }, [giftsThroughIAP]);

  const { availablePlans, iapAvailable } = useAvailablePlans({
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
    } else if (showStorageManager) {
      setShowStorageManager(false);
      refresh();
    } else if (showSharedLinksManager) {
      setShowSharedLinksManager(false);
    } else if (showSyncManager && searchParams?.get('section') !== 'sync') {
      // Back returns to the account page only when Manage Sync was opened
      // there. Opened at section=sync (the library's Sync Settings), Back
      // leaves the page below.
      setShowSyncManager(false);
    } else if (giftView) {
      setGiftView(null);
    } else {
      // A book stays open beneath while this page sits over it (#6607).
      const readerBeneath = Object.keys(useReaderStore.getState().viewStates).length > 0;
      navigateBackFromProfile(router, searchParams?.get('redirect'), readerBeneath);
    }
  };

  const handleStripeSubscribe = async (productId?: string, planType: PlanType = 'subscription') => {
    if (!productId) return;

    // Someone who already holds a subscription changes plan or billing period
    // in the billing portal. Opening a second checkout session would leave the
    // old subscription running alongside the new one and bill them twice. A
    // plan a gift alone sets has no subscription to change, so until the gift
    // status is known the page asks for it rather than guess.
    let giftOnly = giftInfo?.giftOnly;
    if (!giftInfo && shouldUseBillingPortal(userProfilePlan, planType)) {
      const info = await loadGiftInfo();
      if (!info) {
        eventDispatcher.dispatch('toast', {
          type: 'info',
          message: _('Failed to load gift cards'),
        });
        return;
      }
      giftOnly = info.giftOnly;
    }
    if (shouldUseBillingPortal(userProfilePlan, planType, giftOnly)) {
      await openStripePortal('subscription_update');
      return;
    }

    setLoading(true);
    try {
      const { sessionId, clientSecret, url } = await createStripeCheckoutSession(
        productId,
        planType,
      );

      const foundPlan = availablePlans.find((plan) => plan.productId === productId);

      if (!foundPlan) {
        throw new Error(`Plan not found for product ID: ${productId}`);
      }

      const selectedPlan = foundPlan as StripeAvailablePlan;
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
        await redirectToStripeCheckout(url);
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
        // Restored one-time purchases (storage add-ons) may still be
        // unconsumed on Google Play, blocking repurchase; re-verifying lets
        // the server consume them. On iOS, restore is the only flow that can
        // record a purchase whose original verification never reached the
        // server, so re-verify those too.
        await verifyGooglePurchaseProducts(purchases);
        await verifyApplePurchaseProducts(purchases);
        if (!(await refresh())) {
          throw new Error('Failed to refresh session after restoring purchases');
        }
        const restoredSubscriptions = purchases
          .filter((p) => !isPurchaseProduct(p.productId))
          .sort((a, b) => new Date(b.purchaseDate).getTime() - new Date(a.purchaseDate).getTime());
        const purchase = restoredSubscriptions[0];

        if (purchase) {
          router.push(getIAPSubscriptionSuccessUrl(purchase));
        } else if (purchases.some((p) => isPurchaseProduct(p.productId))) {
          eventDispatcher.dispatch('toast', {
            type: 'info',
            message: _('Purchases restored successfully.'),
          });
        } else {
          throw new Error('No subscription found in restored purchases');
        }
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

  const openStripePortal = async (flow?: StripePortalFlow) => {
    setLoading(true);
    try {
      const url = await createStripePortalSession(flow);
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

  const handleManageSubscription = () => openStripePortal();

  const handleDeleteWithMessage = () => {
    handleConfirmDelete(_('Failed to delete user. Please try again later.'));
  };

  const handleDeleteAllBooksWithMessage = () => {
    handleDeleteAllBooks(
      _('All books deleted.'),
      _('Failed to delete books. Please try again later.'),
    );
  };

  const handleManageStorage = () => {
    setShowStorageManager(true);
  };

  const handleManageSharedLinks = () => {
    setShowSharedLinksManager(true);
  };
  const handleManageSync = () => {
    setShowSyncManager(true);
  };
  const handleGiftCard = () => {
    setGiftView('give');
  };
  const handleRedeemGiftCard = () => {
    setGiftView('redeem');
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
  const buyThroughIAP = appService.hasIAP && iapAvailable;
  const gift =
    giftInfo && giftInfo.giftPlan !== 'free' && giftInfo.giftActiveUntil
      ? {
          plan: giftInfo.giftPlan,
          activeUntil: giftInfo.giftActiveUntil,
          giftOnly: giftInfo.giftOnly,
        }
      : undefined;

  return (
    <div
      className={clsx(
        'bg-base-100 full-height inset-0 select-none overflow-hidden',
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
                {/* The gift buy page sells to whoever opens it; their own account
                    isn't part of that. */}
                {giftView !== 'give' && (
                  <div className='flex flex-col gap-y-8 px-6'>
                    <UserInfo
                      avatarUrl={avatarUrl}
                      userFullName={userFullName}
                      userEmail={userEmail}
                      planDetails={userPlanDetails}
                    />

                    {!showStorageManager &&
                      !showSharedLinksManager &&
                      !showSyncManager &&
                      !giftView && <UsageStats quotas={quotas} />}
                  </div>
                )}

                {showStorageManager ? (
                  <div className='flex flex-col gap-y-8 px-6'>
                    <StorageManager />
                  </div>
                ) : showSharedLinksManager ? (
                  <div className='flex flex-col gap-y-8 px-6'>
                    <SharedLinksSection />
                  </div>
                ) : showSyncManager ? (
                  <div className='flex flex-col gap-y-8 px-6'>
                    <SyncCategoriesSection
                      userPlan={userProfilePlan}
                      customizationPurchased={customizationPurchased}
                    />
                    <SyncPassphraseSection />
                    <SyncDevicesSection />
                  </div>
                ) : giftView ? (
                  // Without the account block above it, the buy page clears the
                  // fixed header itself (64px on phones, 84px under macOS
                  // traffic lights).
                  <div
                    className={clsx('flex flex-col gap-y-8 px-6', giftView === 'give' && 'pt-12')}
                  >
                    <GiftCardsSection
                      view={giftView}
                      prices={giftPrices}
                      initialCode={giftCode}
                      stripeSessionId={
                        searchParams?.get('section') === 'gifts'
                          ? searchParams.get('session_id') || undefined
                          : undefined
                      }
                      // An IAP build sells gifts through its store only: store
                      // prices or none, never Stripe while the store loads.
                      useIAP={appService.hasIAP}
                      onPlanChanged={handleGiftPlanChanged}
                    />
                  </div>
                ) : (
                  <>
                    <div className='flex flex-col gap-y-8 px-2 sm:px-6'>
                      <PlansComparison
                        availablePlans={availablePlans}
                        userPlan={userProfilePlan}
                        customizationPurchased={customizationPurchased}
                        gift={gift}
                        giftPrices={giftPrices}
                        onSubscribe={buyThroughIAP ? handleIAPSubscribe : handleStripeSubscribe}
                        onGiftCard={handleGiftCard}
                      />
                    </div>
                    <div className='flex flex-col gap-y-8 px-6'>
                      <AccountActions
                        userEmail={userEmail}
                        planName={_(userPlanDetails.name)}
                        userPlan={userProfilePlan}
                        customizationPurchased={customizationPurchased}
                        iapAvailable={iapAvailable}
                        giftOnly={giftInfo?.giftOnly}
                        onLogout={handleLogout}
                        onResetPassword={handleResetPassword}
                        onUpdateEmail={handleUpdateEmail}
                        onConfirmDelete={handleDeleteWithMessage}
                        onConfirmDeleteAllBooks={handleDeleteAllBooksWithMessage}
                        onRestorePurchase={handleIAPRestorePurchase}
                        onManageSubscription={handleManageSubscription}
                        onManageStorage={handleManageStorage}
                        onManageSharedLinks={handleManageSharedLinks}
                        onManageSync={handleManageSync}
                        onRedeemGiftCard={handleRedeemGiftCard}
                      />
                    </div>
                  </>
                )}

                {/* The account page already carries them; the buy page ends at Buy. */}
                {giftView !== 'give' && <LegalLinks />}
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
