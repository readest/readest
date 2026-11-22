// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GiftCardsSection from '@/app/user/components/gift/GiftCardsSection';
import type { GiftCardsResponse, GiftPrice, SentGiftCard } from '@/types/gift';

const h = vi.hoisted(() => ({
  fetchGiftCards: vi.fn(),
  createGiftDraft: vi.fn(),
  updateGiftCard: vi.fn(),
  redeemGiftCode: vi.fn(),
  fetchGiftPrices: vi.fn(),
  verifyGiftIAPPurchase: vi.fn(),
  createStripeCheckoutSession: vi.fn(),
  redirectToStripeCheckout: vi.fn(),
  purchaseIAPProduct: vi.fn(),
  writeTextToClipboard: vi.fn(),
  dispatch: vi.fn(),
  router: { replace: vi.fn() },
  // Stable identity, like the real memoized useTranslation.
  translate: (key: string, params?: Record<string, string | number>): string =>
    params ? key.replace(/\{\{(\w+)\}\}/g, (_match, name) => String(params[name] ?? '')) : key,
}));

vi.mock('@/libs/payment/gift/client', () => ({
  fetchGiftCards: h.fetchGiftCards,
  createGiftDraft: h.createGiftDraft,
  updateGiftCard: h.updateGiftCard,
  redeemGiftCode: h.redeemGiftCode,
  fetchGiftPrices: h.fetchGiftPrices,
  verifyGiftIAPPurchase: h.verifyGiftIAPPurchase,
  getGiftRedeemLink: (code: string) => `https://web.readest.com/user?gift=${code}`,
}));
vi.mock('@/libs/payment/stripe/client', () => ({
  createStripeCheckoutSession: h.createStripeCheckoutSession,
  redirectToStripeCheckout: h.redirectToStripeCheckout,
}));
vi.mock('@/libs/payment/iap/client', () => ({ purchaseIAPProduct: h.purchaseIAPProduct }));
vi.mock('@/app/user/components/Checkout', () => ({ default: () => null }));
vi.mock('@/services/environment', () => ({
  isTauriAppPlatform: () => false,
  getAPIBaseUrl: () => '/api',
}));
vi.mock('@/utils/access', () => ({ getAccessToken: async () => 'test-token' }));
vi.mock('@/utils/clipboard', () => ({ writeTextToClipboard: h.writeTextToClipboard }));
vi.mock('@/utils/event', () => ({ eventDispatcher: { dispatch: h.dispatch } }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => h.translate }));
vi.mock('@/hooks/useAppRouter', () => ({ useAppRouter: () => h.router }));
vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: { user_metadata: { full_name: 'Alex' } } }),
}));

const STRIPE_PRICES: GiftPrice[] = [
  { tier: 'plus', productId: 'price_gift_plus', price: 3999, currency: 'usd' },
  { tier: 'pro', productId: 'price_gift_pro', price: 7999, currency: 'usd' },
];
const IAP_PRICES: GiftPrice[] = [
  {
    tier: 'plus',
    productId: 'com.bilingify.readest.giftcard_plus.purchase',
    price: 3999,
    currency: 'USD',
  },
  {
    tier: 'pro',
    productId: 'com.bilingify.readest.giftcard_pro.purchase',
    price: 7999,
    currency: 'USD',
  },
];

const response = (overrides: Partial<GiftCardsResponse> = {}): GiftCardsResponse => ({
  sent: [],
  received: [],
  giftPlan: 'free',
  giftActiveUntil: null,
  giftOnly: false,
  ...overrides,
});

const sentCard = (overrides: Partial<SentGiftCard> = {}): SentGiftCard => ({
  id: 'card-1',
  tier: 'plus',
  recipientName: 'Sam',
  senderName: 'Alex',
  message: 'Enjoy the year',
  status: 'unredeemed',
  recipientEmail: null,
  code: 'ABCD-EFGH-JKMN-PQRS',
  purchasedAt: '2026-11-20T10:00:00Z',
  redeemedAt: null,
  ...overrides,
});

const renderSection = (props: Partial<Parameters<typeof GiftCardsSection>[0]> = {}) =>
  render(<GiftCardsSection useIAP={false} onPlanChanged={vi.fn()} {...props} />);

const buyButton = () => screen.findByRole('button', { name: /^Buy for / });
const sentRegion = () => screen.getByRole('region', { name: 'Sent' });

beforeEach(() => {
  h.fetchGiftCards.mockResolvedValue(response());
  h.fetchGiftPrices.mockResolvedValue(STRIPE_PRICES);
  h.createGiftDraft.mockResolvedValue('draft-1');
  h.createStripeCheckoutSession.mockResolvedValue({
    sessionId: 'cs_test_1',
    clientSecret: 'secret_1',
    url: 'https://checkout.stripe.test/cs_test_1',
  });
  h.writeTextToClipboard.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('GiftCardsSection', () => {
  it('buying with Stripe creates a draft then checkout with its id', async () => {
    renderSection();
    await waitFor(() => expect(h.fetchGiftPrices).toHaveBeenCalledWith(false));

    fireEvent.click(screen.getByRole('radio', { name: /Readest Pro/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'To' }), { target: { value: 'Sam' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Enjoy the year' },
    });
    fireEvent.click(await buyButton());

    await waitFor(() =>
      expect(h.createStripeCheckoutSession).toHaveBeenCalledWith('price_gift_pro', 'purchase', {
        giftCardId: 'draft-1',
      }),
    );
    expect(h.createGiftDraft).toHaveBeenCalledWith({
      tier: 'pro',
      recipientName: 'Sam',
      senderName: 'Alex',
      message: 'Enjoy the year',
      recipientEmail: null,
    });
    expect(h.createGiftDraft.mock.invocationCallOrder[0]).toBeLessThan(
      h.createStripeCheckoutSession.mock.invocationCallOrder[0]!,
    );
    await waitFor(() =>
      expect(h.redirectToStripeCheckout).toHaveBeenCalledWith(
        'https://checkout.stripe.test/cs_test_1',
      ),
    );
    expect(h.purchaseIAPProduct).not.toHaveBeenCalled();
    // The page is leaving for Stripe: a second tap must not make a second draft.
    expect(((await buyButton()) as HTMLButtonElement).disabled).toBe(true);
  });

  it('buying with IAP verifies with the draft id', async () => {
    const purchase = {
      platform: 'ios',
      productId: 'com.bilingify.readest.giftcard_plus.purchase',
      transactionId: 'txn-1',
      originalTransactionId: 'txn-1',
    };
    h.fetchGiftPrices.mockResolvedValue(IAP_PRICES);
    h.purchaseIAPProduct.mockResolvedValue(purchase);
    h.verifyGiftIAPPurchase.mockResolvedValue(undefined);

    renderSection({ useIAP: true });
    await waitFor(() => expect(h.fetchGiftPrices).toHaveBeenCalledWith(true));
    fireEvent.click(await buyButton());

    await waitFor(() => expect(h.verifyGiftIAPPurchase).toHaveBeenCalledWith(purchase, 'draft-1'));
    expect(h.purchaseIAPProduct).toHaveBeenCalledWith(
      'com.bilingify.readest.giftcard_plus.purchase',
    );
    expect(h.createStripeCheckoutSession).not.toHaveBeenCalled();
    // The new card shows up in Sent without leaving the view.
    await waitFor(() => expect(h.fetchGiftCards).toHaveBeenCalledTimes(2));
  });

  it('a failed verify on iOS says the payment was received, without Restore Purchase', async () => {
    h.fetchGiftPrices.mockResolvedValue(IAP_PRICES);
    h.purchaseIAPProduct.mockResolvedValue({ platform: 'ios', transactionId: 'txn-1' });
    h.verifyGiftIAPPurchase.mockRejectedValue(new Error('gift_verify_failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSection({ useIAP: true });
    await waitFor(() => expect(h.fetchGiftPrices).toHaveBeenCalledWith(true));
    fireEvent.click(await buyButton());

    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith('toast', {
        type: 'info',
        // The App Store notification retries; StoreKit never restores a consumable.
        message: 'Payment received. Your gift card will appear here shortly.',
      }),
    );
    expect(h.dispatch).not.toHaveBeenCalledWith('toast', {
      type: 'info',
      message: 'Failed to buy the gift card',
    });
    await waitFor(() => expect(h.fetchGiftCards).toHaveBeenCalledTimes(2));
  });

  it('a failed verify on Android points at Restore Purchase', async () => {
    h.fetchGiftPrices.mockResolvedValue(IAP_PRICES);
    h.purchaseIAPProduct.mockResolvedValue({ platform: 'android', purchaseToken: 'token-1' });
    h.verifyGiftIAPPurchase.mockRejectedValue(new Error('gift_verify_failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSection({ useIAP: true });
    await waitFor(() => expect(h.fetchGiftPrices).toHaveBeenCalledWith(true));
    fireEvent.click(await buyButton());

    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith('toast', {
        type: 'info',
        message:
          'Payment received. Your gift card will appear here shortly, or use Restore Purchase.',
      }),
    );
    expect(h.dispatch).not.toHaveBeenCalledWith('toast', {
      type: 'info',
      message: 'Failed to buy the gift card',
    });
    await waitFor(() => expect(h.fetchGiftCards).toHaveBeenCalledTimes(2));
  });

  it('an IAP build with no store products shows no price and never uses Stripe', async () => {
    h.fetchGiftPrices.mockImplementation(async (useIAP: boolean) => (useIAP ? [] : STRIPE_PRICES));

    renderSection({ useIAP: true });
    await waitFor(() => expect(h.fetchGiftPrices).toHaveBeenCalledWith(true));
    await waitFor(() => expect(h.fetchGiftCards).toHaveBeenCalled());

    expect(h.fetchGiftPrices).not.toHaveBeenCalledWith(false);
    expect(screen.queryByText(/\$39\.99|\$79\.99/)).toBeNull();
    const buy = screen.getByRole('button', { name: 'Buy' }) as HTMLButtonElement;
    expect(buy.disabled).toBe(true);
    fireEvent.click(buy);
    expect(h.createGiftDraft).not.toHaveBeenCalled();
    expect(h.createStripeCheckoutSession).not.toHaveBeenCalled();
  });

  it('a returning Stripe session is checked before the list loads', async () => {
    let finishCheck!: (value: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finishCheck = resolve;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/user?section=gifts&session_id=cs_returning');

    renderSection({ stripeSessionId: 'cs_returning' });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/stripe/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ sessionId: 'cs_returning' }),
    });
    expect(h.fetchGiftCards).not.toHaveBeenCalled();
    expect(h.router.replace).not.toHaveBeenCalled();

    finishCheck(new Response(JSON.stringify({ session: {} }), { status: 200 }));
    await waitFor(() => expect(h.fetchGiftCards).toHaveBeenCalledTimes(1));
    // Checked once: the session leaves the URL, so reopening the view doesn't
    // check it again.
    expect(h.router.replace).toHaveBeenCalledWith('/user?section=gifts');
  });

  it('redeem shows the shared error for a bad code', async () => {
    h.redeemGiftCode.mockRejectedValue(new Error('invalid_or_used'));
    const onPlanChanged = vi.fn();
    renderSection({ initialCode: 'ABCD-EFGH-JKMN-PQRS', onPlanChanged });

    const input = (await screen.findByRole('textbox', { name: 'Gift code' })) as HTMLInputElement;
    expect(input.value).toBe('ABCD-EFGH-JKMN-PQRS');
    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));

    expect(await screen.findByText('This code is invalid or has already been used.')).toBeTruthy();
    expect(h.redeemGiftCode).toHaveBeenCalledWith('ABCD-EFGH-JKMN-PQRS');
    expect(onPlanChanged).not.toHaveBeenCalled();
  });

  it('a redeem that returns no card still counts as redeemed', async () => {
    h.redeemGiftCode.mockResolvedValue(null);
    const onPlanChanged = vi.fn();
    renderSection({ initialCode: 'ABCD-EFGH-JKMN-PQRS', onPlanChanged });

    await screen.findByRole('textbox', { name: 'Gift code' });
    fireEvent.click(screen.getByRole('button', { name: 'Redeem' }));

    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith('toast', {
        type: 'info',
        message: 'Gift card redeemed',
      }),
    );
    // The list reloads, as after any redeem.
    await waitFor(() => expect(h.fetchGiftCards).toHaveBeenCalledTimes(2));
  });

  it('the composer blocks a 301st character', async () => {
    renderSection();
    const message = (await screen.findByRole('textbox', {
      name: 'Message',
    })) as HTMLTextAreaElement;

    fireEvent.change(message, { target: { value: 'a'.repeat(301) } });

    expect(message.value).toHaveLength(300);
    expect(screen.getByText('300 / 300')).toBeTruthy();
  });

  it('adding an email asks for confirmation and hides the Add email action after', async () => {
    const card = sentCard();
    const waiting = sentCard({ status: 'waiting', recipientEmail: 'sam@example.test' });
    h.fetchGiftCards
      .mockResolvedValueOnce(response({ sent: [card] }))
      .mockResolvedValue(response({ sent: [waiting] }));
    h.updateGiftCard.mockResolvedValue(waiting);
    renderSection();

    fireEvent.click(await screen.findByRole('button', { name: 'Add recipient email' }));
    fireEvent.change(within(sentRegion()).getByRole('textbox', { name: 'Recipient email' }), {
      target: { value: 'sam@example.test' },
    });
    fireEvent.click(within(sentRegion()).getByRole('button', { name: 'Save' }));

    // Nothing is written until the buyer confirms: the email is set once.
    expect(within(sentRegion()).getByText(/can't be changed later/)).toBeTruthy();
    expect(h.updateGiftCard).not.toHaveBeenCalled();
    fireEvent.click(within(sentRegion()).getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(h.updateGiftCard).toHaveBeenCalledWith('card-1', {
        recipientEmail: 'sam@example.test',
      }),
    );
    await waitFor(() =>
      expect(
        within(sentRegion()).queryByRole('button', { name: 'Add recipient email' }),
      ).toBeNull(),
    );
    expect(within(sentRegion()).getByText('Waiting for sam@example.test to sign up')).toBeTruthy();
  });

  it('sent cards show the code only while unredeemed', async () => {
    h.fetchGiftCards.mockResolvedValue(
      response({
        sent: [
          sentCard({ id: 'a', code: 'AAAA-AAAA-AAAA-AAAA' }),
          sentCard({
            id: 'b',
            status: 'waiting',
            recipientEmail: 'kim@example.test',
            code: 'BBBB-BBBB-BBBB-BBBB',
          }),
          sentCard({ id: 'c', status: 'refunded', code: 'CCCC-CCCC-CCCC-CCCC' }),
          sentCard({ id: 'd', status: 'redeemed', code: null, redeemedAt: '2026-12-25T09:00:00Z' }),
        ],
      }),
    );
    renderSection();

    await screen.findByText('AAAA-AAAA-AAAA-AAAA');
    const sent = sentRegion();
    expect(within(sent).getByText('BBBB-BBBB-BBBB-BBBB')).toBeTruthy();
    expect(within(sent).queryByText('CCCC-CCCC-CCCC-CCCC')).toBeNull();
    expect(within(sent).getByText('Refunded')).toBeTruthy();
    expect(within(sent).getByText(/^Redeemed on /)).toBeTruthy();
    expect(within(sent).getAllByRole('button', { name: 'Copy code' })).toHaveLength(2);

    fireEvent.click(within(sent).getAllByRole('button', { name: 'Copy code' })[0]!);
    await waitFor(() => expect(h.writeTextToClipboard).toHaveBeenCalledWith('AAAA-AAAA-AAAA-AAAA'));
    await waitFor(() =>
      expect(h.dispatch).toHaveBeenCalledWith('toast', { type: 'info', message: 'Copied' }),
    );
  });
});
