'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useAppRouter } from '@/hooks/useAppRouter';
import { useTranslation } from '@/hooks/useTranslation';
import { SectionTitle } from '@/components/settings/primitives';
import {
  createGiftDraft,
  fetchGiftCards,
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
import type {
  GiftCardPatch,
  GiftCardsResponse,
  GiftDraftInput,
  GiftPrice,
  SentGiftCard,
} from '@/types/gift';
import Checkout from '../Checkout';
import { Fleuron, SERIF } from './GiftCard';
import GiftComposer from './GiftComposer';
import ReceivedGiftList from './ReceivedGiftList';
import RedeemGiftForm from './RedeemGiftForm';
import SentGiftList from './SentGiftList';

// The call the subscription success page makes: it records the payment and
// activates the card, so it doesn't wait on the webhook. True once paid, null
// when the check itself failed.
const checkStripeSession = async (sessionId: string): Promise<boolean | null> => {
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
    return null;
  }
};

/** Buying and the cards you bought, or redeeming and the cards you were given. */
export type GiftCardsView = 'give' | 'redeem';

interface GiftCardsSectionProps {
  view: GiftCardsView;
  /** Loaded by the page, which shows the lowest on the Gift Card tile. */
  prices: GiftPrice[];
  initialCode?: string;
  stripeSessionId?: string;
  useIAP: boolean;
  onPlanChanged: () => void;
}

const GiftCardsSection: React.FC<GiftCardsSectionProps> = ({
  view,
  prices,
  initialCode,
  stripeSessionId,
  useIAP,
  onPlanChanged,
}) => {
  const _ = useTranslation();
  const router = useAppRouter();
  const { user } = useAuth();
  const receivedId = useId();
  const redeemId = useId();
  const sentId = useId();
  const redeemRef = useRef<HTMLElement>(null);
  const [cards, setCards] = useState<GiftCardsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  // Bumped after a purchase so the composer starts blank for the next gift.
  const [composerKey, setComposerKey] = useState(0);
  // The card just paid for, opened in Sent for the buyer to write.
  const [writeId, setWriteId] = useState<string | null>(null);
  const [checkout, setCheckout] = useState<{
    clientSecret: string;
    sessionId: string;
    giftCardId: string;
  } | null>(null);
  // Where the gifted plan stood at the last load; a change means the page's
  // plan cards and session are stale.
  const giftState = useRef<string | null>(null);

  const toast = useCallback(
    (message: string) => eventDispatcher.dispatch('toast', { type: 'info', message }),
    [],
  );

  // Only the newest load updates the page: an older, slower one landing last
  // would put back what a save or a redemption had just changed.
  const loads = useRef(0);
  const load = useCallback(async (): Promise<GiftCardsResponse | null> => {
    const mine = ++loads.current;
    try {
      const next = await fetchGiftCards();
      if (mine !== loads.current) return next;
      const state = `${next.giftPlan}:${next.giftActiveUntil}`;
      if (giftState.current !== null && giftState.current !== state) onPlanChanged();
      giftState.current = state;
      setCards(next);
      return next;
    } catch (error) {
      console.error('Failed to load gift cards:', error);
      toast(_('Failed to load gift cards'));
      return null;
    }
  }, [onPlanChanged, toast, _]);

  // Every way back from paying lands here. The store and the embedded
  // checkout know which card they paid for; a redirected checkout returns with
  // only its session, so it opens the newest card.
  const finishPurchase = useCallback(
    async (paid: boolean, giftCardId?: string) => {
      const next = await load();
      if (!paid) return;
      setComposerKey((key) => key + 1);
      // `load` has said the list failed; "ready" over it would read as a lie.
      if (!next) return;
      const bought =
        next.sent.find((card) => card.id === giftCardId) ??
        next.sent.reduce<SentGiftCard | null>(
          (newest, card) => (!newest || card.purchasedAt > newest.purchasedAt ? card : newest),
          null,
        );
      setWriteId(bought?.id ?? null);
      toast(_('Your gift card is ready'));
    },
    [load, toast, _],
  );

  useEffect(() => {
    const open = async () => {
      let paid = false;
      if (stripeSessionId) {
        const checked = await checkStripeSession(stripeSessionId);
        paid = checked === true;
        // Checked once: reopening the view must not check and announce it
        // again. A check that failed keeps the session, so a reload retries.
        if (checked !== null) {
          const params = new URLSearchParams(window.location.search);
          params.delete('session_id');
          router.replace(`${window.location.pathname}?${params}`);
        }
      }
      await finishPurchase(paid);
    };
    void open();
    // Once on open: a returning checkout is checked before the first load.
  }, []);

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
        await finishPurchase(true, giftCardId);
        return;
      }
      const { sessionId, clientSecret, url } = await createStripeCheckoutSession(
        price.productId,
        'purchase',
        { giftCardId },
      );
      if (isTauriAppPlatform() && sessionId && clientSecret) {
        setCheckout({ sessionId, clientSecret, giftCardId });
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

  // `load` refreshes the page's plan only against a plan it saw before; when
  // the first load failed there is none, so a redemption refreshes it here.
  const handleRedeemed = async () => {
    const known = giftState.current !== null;
    await load();
    if (!known) onPlanChanged();
  };

  const handleCheckoutSuccess = useCallback(
    async (sessionId: string) => {
      const giftCardId = checkout?.giftCardId;
      setCheckout(null);
      const paid = (await checkStripeSession(sessionId)) === true;
      // The checkout says it's paid; the webhook still activates the card.
      if (!paid) toast(_('Payment received. Your gift card will appear here shortly.'));
      await finishPurchase(paid, giftCardId);
    },
    [checkout, finishPurchase, toast, _],
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

  const description = (text: string) => (
    <p className='text-base-content/70 text-sm leading-relaxed'>{text}</p>
  );

  if (view === 'redeem') {
    return (
      <div className='flex flex-col gap-10'>
        <div>
          <h2 className='mb-1.5 text-lg font-semibold tracking-tight'>{_('Redeem Gift Card')}</h2>
          {description(_('Cards sent to your email appear here on their own'))}
        </div>

        <section ref={redeemRef} aria-labelledby={redeemId} className='flex flex-col gap-2'>
          <SectionTitle id={redeemId}>{_('Redeem a Code')}</SectionTitle>
          <RedeemGiftForm initialCode={initialCode} onRedeemed={handleRedeemed} />
        </section>

        {received.length > 0 && (
          <section aria-labelledby={receivedId} className='flex flex-col gap-2'>
            <SectionTitle id={receivedId}>{_('Received')}</SectionTitle>
            <ReceivedGiftList cards={received} now={new Date()} />
          </section>
        )}
      </div>
    );
  }

  return (
    <div className='flex flex-col gap-10'>
      {/* One checkout-width column, so Buy sits under the plan on any screen. */}
      <section className='mx-auto flex w-full max-w-md flex-col gap-4'>
        {/* A headline in the card's own type and ornament, not a label: the Gift
            Card tile that opens this already names it. */}
        <header className='mb-2 flex flex-col items-center gap-2 text-center'>
          <h2
            className='text-[1.75rem] font-semibold leading-tight tracking-tight'
            style={{ fontFamily: SERIF }}
          >
            {_('The gift of reading')}
          </h2>
          <Fleuron className='h-auto w-24 not-eink:text-[#b8923f]' />
          {description(_('Give someone a year of Readest Plus or Pro'))}
        </header>
        <GiftComposer
          key={composerKey}
          prices={prices}
          defaultSenderName={user?.user_metadata?.['full_name'] ?? ''}
          busy={busy}
          onBuy={handleBuy}
        />
      </section>

      {sent.length > 0 && (
        <section aria-labelledby={sentId} className='flex flex-col gap-2'>
          <SectionTitle id={sentId}>{_('Sent')}</SectionTitle>
          <SentGiftList cards={sent} writeId={writeId} onUpdate={handleUpdate} />
        </section>
      )}
    </div>
  );
};

export default GiftCardsSection;
