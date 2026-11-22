'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { SectionTitle } from '@/components/settings/primitives';
import {
  createGiftDraft,
  fetchGiftCards,
  fetchGiftPrices,
  updateGiftCard,
  verifyGiftIAPPurchase,
} from '@/libs/payment/gift/client';
import {
  createStripeCheckoutSession,
  redirectToStripeCheckout,
} from '@/libs/payment/stripe/client';
import { purchaseIAPProduct } from '@/libs/payment/iap/client';
import { getAPIBaseUrl, isTauriAppPlatform } from '@/services/environment';
import { getAccessToken } from '@/utils/access';
import { eventDispatcher } from '@/utils/event';
import type { GiftCardPatch, GiftCardsResponse, GiftDraftInput, GiftPrice } from '@/types/gift';
import Checkout from '../Checkout';
import GiftComposer from './GiftComposer';
import ReceivedGiftList from './ReceivedGiftList';
import RedeemGiftForm from './RedeemGiftForm';
import SentGiftList from './SentGiftList';

// The call the subscription success page makes: it records the payment and
// activates the card, so it doesn't wait on the webhook. True once paid.
const checkStripeSession = async (sessionId: string): Promise<boolean> => {
  try {
    const token = await getAccessToken();
    const response = await fetch(`${getAPIBaseUrl()}/stripe/check`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId }),
    });
    const { session } = await response.json();
    return session?.payment_status === 'paid';
  } catch (error) {
    console.error('Failed to check the checkout session:', error);
    return false;
  }
};

interface GiftCardsSectionProps {
  initialCode?: string;
  stripeSessionId?: string;
  useIAP: boolean;
  onPlanChanged: () => void;
}

const GiftCardsSection: React.FC<GiftCardsSectionProps> = ({
  initialCode,
  stripeSessionId,
  useIAP,
  onPlanChanged,
}) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { user } = useAuth();
  const giveId = useId();
  const receivedId = useId();
  const redeemId = useId();
  const sentId = useId();
  const redeemRef = useRef<HTMLElement>(null);
  const [cards, setCards] = useState<GiftCardsResponse | null>(null);
  const [prices, setPrices] = useState<GiftPrice[]>([]);
  const [busy, setBusy] = useState(false);
  // Bumped after a purchase so the composer starts blank for the next gift.
  const [composerKey, setComposerKey] = useState(0);
  const [checkout, setCheckout] = useState<{ clientSecret: string; sessionId: string } | null>(
    null,
  );
  // Where the gifted plan stood at the last load; a change means the page's
  // plan cards and session are stale.
  const giftState = useRef<string | null>(null);

  const toast = useCallback(
    (message: string) => eventDispatcher.dispatch('toast', { type: 'info', message }),
    [],
  );

  const load = useCallback(async () => {
    try {
      const next = await fetchGiftCards();
      const state = `${next.giftPlan}:${next.giftActiveUntil}`;
      if (giftState.current !== null && giftState.current !== state) onPlanChanged();
      giftState.current = state;
      setCards(next);
    } catch (error) {
      console.error('Failed to load gift cards:', error);
      toast(_('Failed to load gift cards'));
    }
  }, [onPlanChanged, toast, _]);

  const finishPurchase = useCallback(
    async (paid: boolean) => {
      await load();
      if (!paid) return;
      setComposerKey((key) => key + 1);
      toast(_('Your gift card is ready'));
    },
    [load, toast, _],
  );

  useEffect(() => {
    const open = async () => {
      let paid = false;
      if (stripeSessionId) {
        paid = await checkStripeSession(stripeSessionId);
        // Checked once: reopening the view must not check and announce it again.
        const params = new URLSearchParams(window.location.search);
        params.delete('session_id');
        router.replace(`${window.location.pathname}?${params}`);
      }
      await finishPurchase(paid);
    };
    void open();
    // Once on open: a returning checkout is checked before the first load.
  }, []);

  useEffect(() => {
    // Never keep one store's prices once the other is in use: a Stripe price
    // id must not reach the store, nor a store id Stripe.
    setPrices([]);
    let stale = false;
    fetchGiftPrices(useIAP)
      .then((next) => {
        if (!stale) setPrices(next);
      })
      .catch((error) => console.error('Failed to load gift prices:', error));
    return () => {
      stale = true;
    };
  }, [useIAP]);

  useEffect(() => {
    // A gift link lands here with its code filled in; bring the form into view.
    if (initialCode) redeemRef.current?.scrollIntoView?.({ block: 'center' });
  }, [initialCode]);

  const handleBuy = async (draft: GiftDraftInput, price: GiftPrice) => {
    setBusy(true);
    // Set once the page is on its way to Stripe: a second tap before it leaves
    // would make a second draft and session.
    let leaving = false;
    try {
      const giftCardId = await createGiftDraft(draft);
      if (useIAP) {
        // A cancelled store sheet throws too; that isn't worth a toast.
        const purchase = await purchaseIAPProduct(price.productId).catch((error) => {
          console.error('IAP purchase error:', error);
          return null;
        });
        if (!purchase) return;
        // The store has charged by now, so don't call a failed verify a failure.
        // iOS recovers by itself: the App Store ONE_TIME_CHARGE notification
        // retries, and StoreKit never restores a consumable. Google Play sends
        // no one-time product notifications; Restore Purchase re-verifies its
        // purchased products, gift SKUs included.
        try {
          await verifyGiftIAPPurchase(purchase, giftCardId);
        } catch (error) {
          console.error('Gift purchase verification failed:', error);
          toast(
            purchase.platform === 'android'
              ? _(
                  'Payment received. Your gift card will appear here shortly, or use Restore Purchase.',
                )
              : _('Payment received. Your gift card will appear here shortly.'),
          );
          await load();
          return;
        }
        await finishPurchase(true);
        return;
      }
      const { sessionId, clientSecret, url } = await createStripeCheckoutSession(
        price.productId,
        'purchase',
        { giftCardId },
      );
      if (isTauriAppPlatform() && sessionId && clientSecret) {
        setCheckout({ sessionId, clientSecret });
      } else {
        await redirectToStripeCheckout(url);
        leaving = true;
      }
    } catch (error) {
      console.error('Gift purchase failed:', error);
      toast(_('Failed to buy the gift card'));
    } finally {
      if (!leaving) setBusy(false);
    }
  };

  const handleCheckoutSuccess = useCallback(
    async (sessionId: string) => {
      setCheckout(null);
      await finishPurchase(await checkStripeSession(sessionId));
    },
    [finishPurchase],
  );

  const handleUpdate = useCallback(
    async (id: string, patch: GiftCardPatch) => {
      try {
        const updated = await updateGiftCard(id, patch);
        // Show the saved card at once; the reload brings any change of status.
        setCards(
          (current) =>
            current && {
              ...current,
              sent: current.sent.map((card) => (card.id === id ? updated : card)),
            },
        );
      } catch (error) {
        console.error('Failed to update the gift card:', error);
        toast(_('Failed to update the gift card'));
        throw error;
      }
      await load();
    },
    [load, toast, _],
  );

  if (checkout) {
    return (
      <Checkout
        title={_('Give a Gift')}
        clientSecret={checkout.clientSecret}
        sessionId={checkout.sessionId}
        onSuccess={handleCheckoutSuccess}
      />
    );
  }

  const received = cards?.received ?? [];
  const sent = cards?.sent ?? [];

  return (
    <div className='flex flex-col gap-10'>
      <div>
        <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Gift Cards')}</h2>
        <p className='text-base-content/70 text-sm leading-relaxed'>
          {_('Give someone a year of Readest Plus or Pro, or redeem a card you were given')}
        </p>
      </div>

      <section aria-labelledby={giveId} className='flex flex-col gap-2'>
        <SectionTitle id={giveId}>{_('Give a Gift')}</SectionTitle>
        <GiftComposer
          key={composerKey}
          prices={prices}
          defaultSenderName={user?.user_metadata?.['full_name'] ?? ''}
          busy={busy}
          onBuy={handleBuy}
        />
      </section>

      {received.length > 0 && (
        <section aria-labelledby={receivedId} className='flex flex-col gap-2'>
          <SectionTitle id={receivedId}>{_('Received')}</SectionTitle>
          <ReceivedGiftList cards={received} now={new Date()} />
        </section>
      )}

      <section ref={redeemRef} aria-labelledby={redeemId} className='flex flex-col gap-2'>
        <SectionTitle id={redeemId}>{_('Redeem a Code')}</SectionTitle>
        <RedeemGiftForm initialCode={initialCode} onRedeemed={load} />
      </section>

      {sent.length > 0 && (
        <section aria-labelledby={sentId} className='flex flex-col gap-2'>
          <SectionTitle id={sentId}>{_('Sent')}</SectionTitle>
          <SentGiftList cards={sent} onUpdate={handleUpdate} />
        </section>
      )}
    </div>
  );
};

export default GiftCardsSection;
