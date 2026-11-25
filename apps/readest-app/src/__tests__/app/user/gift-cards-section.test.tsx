// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GiftCardsSection from '@/app/user/components/gift/GiftCardsSection';
import type { GiftCardsResponse, GiftPrice, ReceivedGiftCard, SentGiftCard } from '@/types/gift';

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
  render(
    <GiftCardsSection
      view='give'
      prices={STRIPE_PRICES}
      useIAP={false}
      onPlanChanged={vi.fn()}
      {...props}
    />,
  );

const buyButton = () => screen.findByRole('button', { name: /^Buy for / });
const sentRegion = () => screen.getByRole('region', { name: 'Sent' });

beforeEach(() => {
  h.fetchGiftCards.mockResolvedValue(response());
  h.fetchGiftPrices.mockResolvedValue([]);
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
  describe('views', () => {
    const receivedCard: ReceivedGiftCard = {
      id: 'card-2',
      tier: 'pro',
      recipientName: 'Alex',
      senderName: 'Sam',
      message: 'For you',
      startsAt: '2026-11-21T10:00:00Z',
      endsAt: '2027-11-21T10:00:00Z',
    };

    beforeEach(() => {
      h.fetchGiftCards.mockResolvedValue(
        response({ sent: [sentCard()], received: [receivedCard] }),
      );
    });

    it('the give view holds the composer and the cards you bought', async () => {
      renderSection({ view: 'give' });

      expect(await buyButton()).toBeTruthy();
      expect(await screen.findByRole('region', { name: 'Sent' })).toBeTruthy();
      // The tile that opens it already says Gift Card (owner: "remove the
      // Gift Card title and the Give a Gift title").
      expect(screen.queryByRole('heading', { name: 'Gift Card' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Give a Gift' })).toBeNull();
      expect(screen.getByText('Give someone a year of Readest Plus or Pro')).toBeTruthy();
      // Owner: "we need a better header".
      expect(screen.getByRole('heading', { name: 'The gift of reading' })).toBeTruthy();
      // Owner chose "buy, then write": nothing to fill in before Buy.
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.getByText('One payment, no subscription')).toBeTruthy();
      expect(screen.getByText('Write the card after you pay')).toBeTruthy();
      expect(screen.getByText('Their year starts when they redeem it')).toBeTruthy();
      expect(screen.queryByRole('textbox', { name: 'Gift code' })).toBeNull();
      expect(screen.queryByRole('region', { name: 'Received' })).toBeNull();
    });

    it('the redeem view holds the redeem form and the cards you were given', async () => {
      renderSection({ view: 'redeem' });

      expect(await screen.findByRole('region', { name: 'Received' })).toBeTruthy();
      expect(screen.getByRole('heading', { name: 'Redeem Gift Card' })).toBeTruthy();
      expect(screen.getByRole('textbox', { name: 'Gift code' })).toBeTruthy();
      expect(screen.queryByRole('region', { name: 'Sent' })).toBeNull();
      expect(screen.queryByRole('button', { name: /^Buy for / })).toBeNull();
    });
  });

  // The page loads the prices once, for the Gift Card tile and this view.
  it('sells at the prices the page passes in and fetches none of its own', async () => {
    renderSection();

    expect((await buyButton()).textContent).toContain('39.99');
    expect(h.fetchGiftPrices).not.toHaveBeenCalled();
  });

  it('buying with Stripe creates a draft then checkout with its id', async () => {
    renderSection();

    fireEvent.click(screen.getByRole('radio', { name: /Readest Pro/ }));
    fireEvent.click(await buyButton());

    await waitFor(() =>
      expect(h.createStripeCheckoutSession).toHaveBeenCalledWith('price_gift_pro', 'purchase', {
        giftCardId: 'draft-1',
      }),
    );
    // Written after paying: the card starts blank, signed by the buyer.
    expect(h.createGiftDraft).toHaveBeenCalledWith({
      tier: 'pro',
      recipientName: '',
      senderName: 'Alex',
      message: '',
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

  // Owner: "say what Plus or Pro includes".
  it('shows what the picked plan includes', async () => {
    renderSection();
    await buyButton();

    expect(screen.getByText('Unlimited AI Read Aloud Hours')).toBeTruthy();
    // Owner: "Cloud Sync Storage • 5 GB, don't use the •".
    expect(screen.getByText('5 GB Cloud Sync Storage')).toBeTruthy();
    expect(screen.queryByText('Includes All Free Plan Benefits')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: /Readest Pro/ }));
    expect(screen.getByText('Includes All Plus Plan Benefits')).toBeTruthy();
    expect(screen.getByText('20 GB Cloud Sync Storage')).toBeTruthy();
    expect(screen.queryByText('Priority Support')).toBeNull();
  });

  it('after paying, the card just bought opens for writing', async () => {
    const older = sentCard({ id: 'old', code: 'OLDC-OLDC-OLDC-OLDC' });
    const bought = sentCard({
      id: 'new',
      recipientName: '',
      message: '',
      code: 'NEWC-NEWC-NEWC-NEWC',
      purchasedAt: '2026-11-25T10:00:00Z',
    });
    h.fetchGiftCards
      .mockResolvedValueOnce(response({ sent: [older] }))
      .mockResolvedValue(response({ sent: [older, bought] }));
    h.purchaseIAPProduct.mockResolvedValue({ platform: 'ios', transactionId: 'txn-1' });
    h.verifyGiftIAPPurchase.mockResolvedValue(undefined);
    renderSection({ useIAP: true, prices: IAP_PRICES });

    fireEvent.click(await buyButton());

    const item = (code: string) => screen.getByText(code).closest('li') as HTMLElement;
    await waitFor(() =>
      expect(within(item('NEWC-NEWC-NEWC-NEWC')).getByRole('textbox', { name: 'To' })).toBeTruthy(),
    );
    expect(
      item('NEWC-NEWC-NEWC-NEWC').querySelector('[data-tier]')?.getAttribute('data-side'),
    ).toBe('back');
    expect(within(item('OLDC-OLDC-OLDC-OLDC')).queryByRole('textbox')).toBeNull();
  });

  it('buying with IAP verifies with the draft id', async () => {
    const purchase = {
      platform: 'ios',
      productId: 'com.bilingify.readest.giftcard_plus.purchase',
      transactionId: 'txn-1',
      originalTransactionId: 'txn-1',
    };
    h.purchaseIAPProduct.mockResolvedValue(purchase);
    h.verifyGiftIAPPurchase.mockResolvedValue(undefined);

    renderSection({ useIAP: true, prices: IAP_PRICES });
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
    h.purchaseIAPProduct.mockResolvedValue({ platform: 'ios', transactionId: 'txn-1' });
    h.verifyGiftIAPPurchase.mockRejectedValue(new Error('gift_verify_failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSection({ useIAP: true, prices: IAP_PRICES });
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
    h.purchaseIAPProduct.mockResolvedValue({ platform: 'android', purchaseToken: 'token-1' });
    h.verifyGiftIAPPurchase.mockRejectedValue(new Error('gift_verify_failed'));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    renderSection({ useIAP: true, prices: IAP_PRICES });
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
    renderSection({ useIAP: true, prices: [] });
    await waitFor(() => expect(h.fetchGiftCards).toHaveBeenCalled());

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
    renderSection({ view: 'redeem', initialCode: 'ABCD-EFGH-JKMN-PQRS', onPlanChanged });

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
    renderSection({ view: 'redeem', initialCode: 'ABCD-EFGH-JKMN-PQRS', onPlanChanged });

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

  it('the card editor blocks a 301st character', async () => {
    h.fetchGiftCards.mockResolvedValue(response({ sent: [sentCard({ message: '' })] }));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit message' }));
    const message = within(sentRegion()).getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;

    fireEvent.change(message, { target: { value: 'a'.repeat(301) } });

    expect(message.value).toHaveLength(300);
    expect(screen.getByText('300 / 300')).toBeTruthy();
  });

  it('the preview card shows the To and message placeholders, signed by the buyer', async () => {
    renderSection();
    await buyButton();
    const preview = () => document.querySelector('[data-tier]') as HTMLElement;

    expect(within(preview()).getByText('Their name')).toBeTruthy();
    expect(within(preview()).getByText('Write a few words for them')).toBeTruthy();
    // From is filled from the account, so its placeholder stays off the card.
    expect(within(preview()).queryByText('Your name')).toBeNull();
    expect(within(preview()).getByText('Alex')).toBeTruthy();
  });

  it('a plan pick shows the cover, and the buyer can turn the preview over', async () => {
    renderSection();
    await buyButton();
    const preview = () => document.querySelector('[data-tier]') as HTMLElement;
    expect(preview().getAttribute('data-side')).toBe('front');

    fireEvent.click(within(preview()).getByRole('button', { name: 'Turn over' }));
    expect(preview().getAttribute('data-side')).toBe('back');

    fireEvent.click(screen.getByRole('radio', { name: /Readest Pro/ }));
    expect(preview().getAttribute('data-side')).toBe('front');
  });

  it('the message counter reads left to right in an RTL layout', async () => {
    h.fetchGiftCards.mockResolvedValue(response({ sent: [sentCard({ message: '' })] }));
    renderSection();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit message' }));

    expect(within(sentRegion()).getByText('0 / 300').getAttribute('dir')).toBe('ltr');
  });

  it('a sent card shows the message being edited, and the saved one after', async () => {
    const card = sentCard();
    h.fetchGiftCards
      .mockResolvedValueOnce(response({ sent: [card] }))
      .mockRejectedValue(new Error('offline'));
    h.updateGiftCard.mockResolvedValue(sentCard({ message: 'Happy reading' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderSection();

    const face = () => sentRegion().querySelector('[data-tier]') as HTMLElement;
    fireEvent.click(await screen.findByRole('button', { name: 'Edit message' }));
    // The message is on the bookplate, so editing it shows that side.
    expect(face().getAttribute('data-side')).toBe('back');
    fireEvent.change(within(sentRegion()).getByRole('textbox', { name: 'Message' }), {
      target: { value: 'Happy reading' },
    });
    expect(within(face()).getByText('Happy reading')).toBeTruthy();

    fireEvent.click(within(sentRegion()).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(within(sentRegion()).queryByRole('textbox', { name: 'Message' })).toBeNull(),
    );
    // The reload after the save failed; the card still shows what was saved.
    expect(within(face()).getByText('Happy reading')).toBeTruthy();
    expect(within(face()).queryByText('Enjoy the year')).toBeNull();
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
    // The email is only asked for here now, so the Hide My Email advice is too.
    expect(within(sentRegion()).getByText(/Hide My Email, use the code instead/)).toBeTruthy();
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
